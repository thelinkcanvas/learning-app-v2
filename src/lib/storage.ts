/**
 * Storage Layer V2 - 分析結果の永続化
 *
 * MVP の localStorage 運用と後方互換性を保ちつつ、
 * 日次分析結果・週間レポートを追加保存できるよう拡張する。
 *
 * キー設計（MVP との衝突回避）:
 * - `conversation_{subject}_{date}` : MVP 側（変更しない）
 * - `analysis_{subject}_{date}`     : V2 日次分析結果
 * - `weekly_report_{weekStart}`     : V2 週間レポート
 * - `analysis_meta`                 : インデックス・メタデータ
 *
 * 全関数は SSR セーフ（window が undefined なら null/[] を返す）。
 */

import {
  DailyAnalysisResult,
  WeeklyReportData,
  TimestampedMessage,
} from './types/analysis';

// ============================================================================
// Key Builders (テスト・UI から再利用可能)
// ============================================================================

export const STORAGE_KEYS = {
  conversation: (subject: string, date: string) =>
    `conversation_${subject}_${date}`,
  analysis: (subject: string, date: string) => `analysis_${subject}_${date}`,
  weeklyReport: (weekStart: string) => `weekly_report_${weekStart}`,
  meta: () => 'analysis_meta',
} as const;

// ============================================================================
// Storage Schema Versioning
// ============================================================================

const STORAGE_SCHEMA_VERSION = 1;

interface StorageEnvelope<T> {
  schemaVersion: number;
  savedAt: string; // ISO 8601
  data: T;
}

interface AnalysisMeta {
  schemaVersion: number;
  lastUpdated: string;
  dailyAnalysisKeys: string[]; // 保存済み日次分析キーのインデックス
  weeklyReportKeys: string[];  // 保存済み週間レポートキーのインデックス
}

// ============================================================================
// Low-level helpers
// ============================================================================

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function writeRaw<T>(key: string, data: T): boolean {
  if (!isBrowser()) return false;
  const envelope: StorageEnvelope<T> = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    data,
  };
  try {
    localStorage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch (e) {
    console.error(`[storage] write failed for key=${key}:`, e);
    return false;
  }
}

function readRaw<T>(key: string): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as StorageEnvelope<T> | T;
    // 旧形式（envelope なし）対応
    if (
      envelope &&
      typeof envelope === 'object' &&
      'schemaVersion' in envelope &&
      'data' in envelope
    ) {
      return (envelope as StorageEnvelope<T>).data;
    }
    // envelope なしの旧データもそのまま返す
    return envelope as T;
  } catch (e) {
    console.error(`[storage] read/parse failed for key=${key}:`, e);
    return null;
  }
}

function removeRaw(key: string): boolean {
  if (!isBrowser()) return false;
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    console.error(`[storage] remove failed for key=${key}:`, e);
    return false;
  }
}

// ============================================================================
// Meta Index (保存済みデータの一覧管理)
// ============================================================================

function loadMeta(): AnalysisMeta {
  const meta = readRaw<AnalysisMeta>(STORAGE_KEYS.meta());
  if (meta && typeof meta === 'object' && Array.isArray(meta.dailyAnalysisKeys)) {
    return meta;
  }
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    lastUpdated: new Date().toISOString(),
    dailyAnalysisKeys: [],
    weeklyReportKeys: [],
  };
}

function saveMeta(meta: AnalysisMeta): void {
  meta.lastUpdated = new Date().toISOString();
  writeRaw(STORAGE_KEYS.meta(), meta);
}

function addKeyToMeta(kind: 'daily' | 'weekly', key: string): void {
  const meta = loadMeta();
  const arr = kind === 'daily' ? meta.dailyAnalysisKeys : meta.weeklyReportKeys;
  if (!arr.includes(key)) {
    arr.push(key);
    saveMeta(meta);
  }
}

function removeKeyFromMeta(kind: 'daily' | 'weekly', key: string): void {
  const meta = loadMeta();
  if (kind === 'daily') {
    meta.dailyAnalysisKeys = meta.dailyAnalysisKeys.filter((k) => k !== key);
  } else {
    meta.weeklyReportKeys = meta.weeklyReportKeys.filter((k) => k !== key);
  }
  saveMeta(meta);
}

// ============================================================================
// Conversation (MVP 互換 - 既存の `conversation_*` キー)
// ============================================================================

/**
 * MVP 形式の会話ログを読み込み、timestamp を補完して分析用に整形する
 *
 * @param subject - 教科
 * @param date - YYYY-MM-DD
 * @returns TimestampedMessage[]（timestamp が無い場合は保存時刻を推定）
 */
export function loadConversationAsTimestamped(
  subject: string,
  date: string
): TimestampedMessage[] {
  if (!isBrowser()) return [];
  const key = STORAGE_KEYS.conversation(subject, date);
  const raw = localStorage.getItem(key);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    // MVP 形式：{ role, content }[] のプレーン配列
    // V2 形式：{ role, content, timestamp }[] 既に timestamp 付き
    if (!Array.isArray(parsed)) return [];

    // timestamp 欠如なら均等分散で推定（分析精度低下は許容、後方互換性優先）
    const hasTimestamp = parsed.every(
      (m) => typeof m === 'object' && m !== null && 'timestamp' in m
    );
    if (hasTimestamp) return parsed as TimestampedMessage[];

    // timestamp なし：当日 10:00 から 5 分間隔で推定
    const base = new Date(`${date}T10:00:00Z`);
    return parsed.map((m: { role: string; content: string }, i: number) => {
      const t = new Date(base);
      t.setMinutes(t.getMinutes() + i * 5);
      return {
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: t.toISOString(),
      };
    });
  } catch (e) {
    console.error(`[storage] loadConversation failed:`, e);
    return [];
  }
}

// ============================================================================
// Daily Analysis CRUD
// ============================================================================

/**
 * 日次分析結果を保存
 */
export function saveDailyAnalysis(result: DailyAnalysisResult): boolean {
  const key = STORAGE_KEYS.analysis(result.subject, result.date);
  const ok = writeRaw(key, result);
  if (ok) addKeyToMeta('daily', key);
  return ok;
}

/**
 * 日次分析結果を読み込み
 */
export function loadDailyAnalysis(
  subject: string,
  date: string
): DailyAnalysisResult | null {
  return readRaw<DailyAnalysisResult>(STORAGE_KEYS.analysis(subject, date));
}

/**
 * 日次分析結果を削除
 */
export function deleteDailyAnalysis(subject: string, date: string): boolean {
  const key = STORAGE_KEYS.analysis(subject, date);
  const ok = removeRaw(key);
  if (ok) removeKeyFromMeta('daily', key);
  return ok;
}

/**
 * 日付範囲で日次分析結果を取得（週間分析用）
 *
 * @param subject - 教科（null なら全教科）
 * @param startDate - YYYY-MM-DD（含む）
 * @param endDate - YYYY-MM-DD（含む）
 */
export function loadDailyAnalysisRange(
  subject: string | null,
  startDate: string,
  endDate: string
): DailyAnalysisResult[] {
  if (!isBrowser()) return [];
  const meta = loadMeta();
  const results: DailyAnalysisResult[] = [];

  for (const key of meta.dailyAnalysisKeys) {
    // key format: analysis_{subject}_{date}
    const match = key.match(/^analysis_([^_]+)_(\d{4}-\d{2}-\d{2})$/);
    if (!match) continue;
    const [, keySubject, keyDate] = match;

    if (subject !== null && keySubject !== subject) continue;
    if (keyDate < startDate || keyDate > endDate) continue;

    const data = readRaw<DailyAnalysisResult>(key);
    if (data) results.push(data);
  }

  // 日付昇順
  results.sort((a, b) => a.date.localeCompare(b.date));
  return results;
}

/**
 * すべての日次分析結果キーを一覧
 */
export function listDailyAnalysisKeys(): string[] {
  if (!isBrowser()) return [];
  return [...loadMeta().dailyAnalysisKeys];
}

// ============================================================================
// Weekly Report CRUD
// ============================================================================

/**
 * 週間レポートを保存
 *
 * @param weekStart - 週開始日 YYYY-MM-DD（月曜推奨）
 */
export function saveWeeklyReport(
  weekStart: string,
  report: WeeklyReportData
): boolean {
  const key = STORAGE_KEYS.weeklyReport(weekStart);
  const ok = writeRaw(key, report);
  if (ok) addKeyToMeta('weekly', key);
  return ok;
}

/**
 * 週間レポートを読み込み
 */
export function loadWeeklyReport(weekStart: string): WeeklyReportData | null {
  return readRaw<WeeklyReportData>(STORAGE_KEYS.weeklyReport(weekStart));
}

/**
 * 週間レポートを削除
 */
export function deleteWeeklyReport(weekStart: string): boolean {
  const key = STORAGE_KEYS.weeklyReport(weekStart);
  const ok = removeRaw(key);
  if (ok) removeKeyFromMeta('weekly', key);
  return ok;
}

/**
 * すべての週間レポートキーを一覧
 */
export function listWeeklyReportKeys(): string[] {
  if (!isBrowser()) return [];
  return [...loadMeta().weeklyReportKeys];
}

// ============================================================================
// Maintenance
// ============================================================================

/**
 * V2 の分析データのみ全消去（MVP の conversation_* は保持）
 */
export function clearAllAnalysisData(): number {
  if (!isBrowser()) return 0;
  const meta = loadMeta();
  let count = 0;
  for (const key of [...meta.dailyAnalysisKeys, ...meta.weeklyReportKeys]) {
    if (removeRaw(key)) count++;
  }
  removeRaw(STORAGE_KEYS.meta());
  return count;
}

/**
 * 古い分析データをクリーンアップ（保持日数指定）
 *
 * @param retainDays - 保持する日数（デフォルト 30 日）
 * @returns 削除した件数
 */
export function pruneOldAnalysisData(retainDays = 30): number {
  if (!isBrowser()) return 0;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retainDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const meta = loadMeta();
  let deleted = 0;

  for (const key of [...meta.dailyAnalysisKeys]) {
    const match = key.match(/analysis_[^_]+_(\d{4}-\d{2}-\d{2})$/);
    if (match && match[1] < cutoffStr) {
      if (removeRaw(key)) {
        meta.dailyAnalysisKeys = meta.dailyAnalysisKeys.filter((k) => k !== key);
        deleted++;
      }
    }
  }
  for (const key of [...meta.weeklyReportKeys]) {
    const match = key.match(/weekly_report_(\d{4}-\d{2}-\d{2})$/);
    if (match && match[1] < cutoffStr) {
      if (removeRaw(key)) {
        meta.weeklyReportKeys = meta.weeklyReportKeys.filter((k) => k !== key);
        deleted++;
      }
    }
  }

  saveMeta(meta);
  return deleted;
}

/**
 * Storage 使用量を概算（バイト単位）
 */
export function estimateAnalysisStorageSize(): number {
  if (!isBrowser()) return 0;
  const meta = loadMeta();
  let total = 0;
  for (const key of [...meta.dailyAnalysisKeys, ...meta.weeklyReportKeys]) {
    const raw = localStorage.getItem(key);
    if (raw) total += raw.length * 2; // UTF-16 近似
  }
  return total;
}
