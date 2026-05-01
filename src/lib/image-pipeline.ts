/**
 * 画像処理パイプライン（決定論的後処理レイヤ）
 *
 * 設計根拠：
 * - Gemini API は WebP 強制不可・1280×800 もネイティブ非対応のため、
 *   生成時は 2K + 16:9 でオーバーサンプリング → ここで決定論的に整形する。
 * - center-crop は教材テンプレートの「日の丸構図」前提で安全。
 * - WebP は予測符号化で同 SSIM を保ったまま JPEG 比 25-34% 削減できる。
 */

import sharp from 'sharp';

export const TARGET_WIDTH = 1280;
export const TARGET_HEIGHT = 800;
export const MAX_SIZE_BYTES = 200 * 1024;

export interface ProcessOptions {
  /** WebP 品質（0-100）。デフォルト 80。200KB 超過時は段階的に下げる */
  quality?: number;
  /** 200KB 超過時に再帰的に quality を下げて再エンコードするか */
  autoShrink?: boolean;
}

export interface ProcessedImage {
  buffer: Buffer;
  sizeBytes: number;
  width: number;
  height: number;
  qualityUsed: number;
}

/**
 * Gemini API から返却された Base64 画像（多くは JPEG）を、
 * 1280×800 WebP（≤200KB）に変換する。
 *
 * @param sourceBuffer 生成された元画像の Buffer
 * @param opts 処理オプション
 */
export async function processToTemplateWebP(
  sourceBuffer: Buffer,
  opts: ProcessOptions = {}
): Promise<ProcessedImage> {
  const { quality = 80, autoShrink = true } = opts;

  return await encodeRecursively(sourceBuffer, quality, autoShrink);
}

async function encodeRecursively(
  sourceBuffer: Buffer,
  quality: number,
  autoShrink: boolean
): Promise<ProcessedImage> {
  // 中央クロップ + Lanczos リサンプリング → WebP エンコード
  const buffer = await sharp(sourceBuffer)
    .resize({
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT,
      fit: sharp.fit.cover,
      position: sharp.strategy.attention, // 注視点ベース。テキスト中心テンプレに有利
    })
    .webp({
      quality,
      effort: 6, // 圧縮効率最大
      smartSubsample: true,
    })
    .toBuffer();

  const sizeBytes = buffer.length;

  // 200KB 超過時の段階的フォールバック
  if (sizeBytes > MAX_SIZE_BYTES && autoShrink && quality > 50) {
    const nextQuality = Math.max(50, quality - 10);
    return encodeRecursively(sourceBuffer, nextQuality, autoShrink);
  }

  const meta = await sharp(buffer).metadata();
  return {
    buffer,
    sizeBytes,
    width: meta.width ?? TARGET_WIDTH,
    height: meta.height ?? TARGET_HEIGHT,
    qualityUsed: quality,
  };
}

/**
 * Base64 文字列（data URL プレフィックスあり/なし両対応）を Buffer に変換。
 */
export function base64ToBuffer(base64: string): Buffer {
  const stripped = base64.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(stripped, 'base64');
}

/**
 * 仕様準拠チェック（ポストバリデーション）。
 * 生成 → 整形後に CI/CD で再確認する用途。
 */
export function validateSpec(processed: ProcessedImage): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (processed.width !== TARGET_WIDTH) {
    errors.push(`幅が ${TARGET_WIDTH}px ではない: ${processed.width}px`);
  }
  if (processed.height !== TARGET_HEIGHT) {
    errors.push(`高さが ${TARGET_HEIGHT}px ではない: ${processed.height}px`);
  }
  if (processed.sizeBytes > MAX_SIZE_BYTES) {
    errors.push(
      `ファイルサイズが ${(MAX_SIZE_BYTES / 1024).toFixed(0)}KB を超過: ` +
        `${(processed.sizeBytes / 1024).toFixed(1)}KB`
    );
  }

  return { ok: errors.length === 0, errors };
}
