/**
 * Vision API ローカルキャッシュ
 *
 * 用途:
 * - 同じ画像を複数回送らない (再撮影時の API 節約)
 * - SHA-256 ハッシュ + 解像度で複合キー
 * - TTL 1 時間
 *
 * 実装:
 * - ブラウザ: IndexedDB (5MB 超の Blob にも対応)
 * - Node (CLI): メモリのみ (プロセス終了で消失)
 *
 * 詳細仕様: skills/vision-api-spec.md (6. キャッシング戦略)
 */

import type {
  LocalImageCacheEntry,
  VisionAnalysisResult,
} from '../types/vision';
import { LOCAL_CACHE_TTL_MS } from '../types/vision';

// ============================================================================
// SHA-256 ハッシュ計算
// ============================================================================

/**
 * Blob から SHA-256 ハッシュを 16 進文字列で取得。
 * ブラウザ (Web Crypto API) と Node (node:crypto) 両対応。
 */
export async function hashImage(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();

  // ブラウザ: Web Crypto API
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return bufferToHex(hashBuffer);
  }

  // Node fallback
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
  const hash = nodeCrypto.createHash('sha256');
  hash.update(Buffer.from(arrayBuffer));
  return hash.digest('hex');
}

/**
 * base64 文字列からハッシュを取得 (画像が既に encode 済みの場合)。
 */
export async function hashBase64(base64: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = base64ToUint8Array(base64);
    // 専用 ArrayBuffer を確保してから渡す (TS の SharedArrayBuffer 型不一致を回避)
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return bufferToHex(hashBuffer);
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
  return nodeCrypto.createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * 複合キー: hash + (任意の) size を組み合わせる
 * (同じハッシュで違うサイズはほぼないが、念のため衝突対策)
 */
export function buildCacheKey(hash: string, sizeBytes?: number): string {
  return sizeBytes ? `${hash}-${sizeBytes}` : hash;
}

// ============================================================================
// キャッシュストア抽象
// ============================================================================

export interface VisionCacheStore {
  get(key: string): Promise<LocalImageCacheEntry | null>;
  set(key: string, entry: LocalImageCacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  cleanup(): Promise<number>;
}

// ============================================================================
// MemoryCacheStore (Node CLI / テスト用)
// ============================================================================

export class MemoryCacheStore implements VisionCacheStore {
  private readonly store = new Map<string, LocalImageCacheEntry>();

  async get(key: string): Promise<LocalImageCacheEntry | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async set(key: string, entry: LocalImageCacheEntry): Promise<void> {
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async cleanup(): Promise<number> {
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private isExpired(entry: LocalImageCacheEntry): boolean {
    return Date.now() - entry.cached_at > entry.ttl_ms;
  }

  /** テスト用: 内容クリア */
  clear(): void {
    this.store.clear();
  }

  /** テスト用: サイズ取得 */
  size(): number {
    return this.store.size;
  }
}

// ============================================================================
// IndexedDBCacheStore (ブラウザ用)
// ============================================================================

const DB_NAME = 'vision-cache';
const STORE_NAME = 'entries';
const DB_VERSION = 1;

export class IndexedDBCacheStore implements VisionCacheStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not available in this environment');
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
      });
    }
    return this.dbPromise;
  }

  async get(key: string): Promise<LocalImageCacheEntry | null> {
    const db = await this.getDb();
    return new Promise<LocalImageCacheEntry | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const entry = req.result as LocalImageCacheEntry | undefined;
        if (!entry) {
          resolve(null);
          return;
        }
        if (Date.now() - entry.cached_at > entry.ttl_ms) {
          // 期限切れ: 削除して null
          this.delete(key).catch(() => undefined);
          resolve(null);
          return;
        }
        resolve(entry);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async set(key: string, entry: LocalImageCacheEntry): Promise<void> {
    const db = await this.getDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      // hash プロパティが key になるよう entry を整形
      const stored: LocalImageCacheEntry & { hash: string } = { ...entry, hash: key };
      const req = tx.objectStore(STORE_NAME).put(stored);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async delete(key: string): Promise<void> {
    const db = await this.getDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async cleanup(): Promise<number> {
    const db = await this.getDb();
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      let removed = 0;
      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cursor) {
          resolve(removed);
          return;
        }
        const entry = cursor.value as LocalImageCacheEntry;
        if (Date.now() - entry.cached_at > entry.ttl_ms) {
          cursor.delete();
          removed++;
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }
}

// ============================================================================
// ファクトリ + 高レベル API
// ============================================================================

let defaultStore: VisionCacheStore | null = null;

/** 環境に応じたデフォルトのキャッシュストアを返す (シングルトン) */
export function getDefaultCacheStore(): VisionCacheStore {
  if (!defaultStore) {
    if (typeof indexedDB !== 'undefined') {
      defaultStore = new IndexedDBCacheStore();
    } else {
      defaultStore = new MemoryCacheStore();
    }
  }
  return defaultStore;
}

/** テスト用: デフォルトストアの差し替え */
export function setDefaultCacheStore(store: VisionCacheStore): void {
  defaultStore = store;
}

/**
 * 解析結果をキャッシュに保存。
 */
export async function cacheVisionResult(
  hash: string,
  result: VisionAnalysisResult,
  ttlMs: number = LOCAL_CACHE_TTL_MS,
  store: VisionCacheStore = getDefaultCacheStore()
): Promise<void> {
  await store.set(hash, {
    hash,
    vision_result: result,
    cached_at: Date.now(),
    ttl_ms: ttlMs,
  });
}

/**
 * キャッシュから解析結果を取得 (期限切れは null)。
 */
export async function getCachedVisionResult(
  hash: string,
  store: VisionCacheStore = getDefaultCacheStore()
): Promise<VisionAnalysisResult | null> {
  const entry = await store.get(hash);
  return entry?.vision_result ?? null;
}
