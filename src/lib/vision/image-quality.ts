/**
 * 画像品質チェック (クライアント側事前検証)
 *
 * 設計方針:
 * - ブラウザ環境を主用途 (Canvas API)
 * - Node.js でも動作するよう、ImageData ベースの純粋関数を分離
 *   (Sharp/Jimp 等の重い依存は持たない)
 *
 * 機能:
 * - ラプラシアン分散によるブレ検出
 * - 平均輝度による暗さ検出
 * - JPEG への自動圧縮 (5MB / 1600px 上限)
 * - アスペクト比の妥当性チェック
 *
 * 詳細仕様: skills/vision-api-spec.md (7. エラーハンドリング)
 */

import type {
  LocalImageQualityCheck,
  ImageQualityIssue,
} from '../types/vision';
import {
  BLUR_THRESHOLD,
  DARKNESS_THRESHOLD,
  MAX_FILE_SIZE_BYTES,
  MAX_IMAGE_DIMENSION,
} from '../types/vision';

// ============================================================================
// 純粋関数: ImageData ベースの計算 (Node でもテスト可能)
// ============================================================================

/**
 * 3x3 ラプラシアンカーネルで分散を計算 (ブレ検出指標)。
 *
 * 高い値 = エッジが鮮明 = ピントが合っている
 * 低い値 (< 100 目安) = ブレている、もしくはコントラスト不足
 *
 * 注: フル実装は重いので、グレースケール変換 + サブサンプリングで高速化。
 *
 * @param imageData  Canvas getImageData() の結果
 * @param sampleStride  サブサンプリング間隔 (デフォルト 4 = 1/16 サンプル)
 */
export function calculateLaplacianVariance(
  imageData: ImageData,
  sampleStride: number = 4
): number {
  const { data, width, height } = imageData;
  const responses: number[] = [];

  // ラプラシアン: center * 4 - (top + bottom + left + right)
  for (let y = 1; y < height - 1; y += sampleStride) {
    for (let x = 1; x < width - 1; x += sampleStride) {
      const i = (y * width + x) * 4;
      const center = grayscale(data, i);
      const top = grayscale(data, i - width * 4);
      const bottom = grayscale(data, i + width * 4);
      const left = grayscale(data, i - 4);
      const right = grayscale(data, i + 4);

      const laplacian = Math.abs(center * 4 - top - bottom - left - right);
      responses.push(laplacian);
    }
  }

  if (responses.length === 0) return 0;

  const mean = responses.reduce((sum, v) => sum + v, 0) / responses.length;
  const variance =
    responses.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) /
    responses.length;

  return variance;
}

/**
 * 平均輝度を計算 (0-255)。サブサンプリングで高速化。
 */
export function calculateMeanBrightness(
  imageData: ImageData,
  sampleStride: number = 4
): number {
  const { data, width, height } = imageData;
  let sum = 0;
  let count = 0;

  for (let y = 0; y < height; y += sampleStride) {
    for (let x = 0; x < width; x += sampleStride) {
      const i = (y * width + x) * 4;
      sum += grayscale(data, i);
      count++;
    }
  }

  return count > 0 ? sum / count : 0;
}

/** R/G/B (data[i..i+2]) からグレースケール輝度を ITU-R BT.601 で算出 */
function grayscale(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

// ============================================================================
// ブラウザ統合: Blob / File からの ImageData 取得
// ============================================================================

/**
 * Blob → HTMLImageElement → Canvas → ImageData の変換。
 * ブラウザ専用 (Node では不可)。
 */
export async function blobToImageData(blob: Blob): Promise<ImageData> {
  if (typeof window === 'undefined') {
    throw new Error('blobToImageData requires a browser environment');
  }

  const img = await blobToImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D canvas context');
  }
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${String(e)}`));
    };
    img.src = url;
  });
}

// ============================================================================
// メイン: 総合品質チェック
// ============================================================================

/**
 * Blob (撮影画像) を解析し、Vision API へ送信可能か判定する。
 *
 * @returns LocalImageQualityCheck (各メトリクス + issues 配列)
 */
export async function assessLocalQuality(
  blob: Blob
): Promise<LocalImageQualityCheck> {
  const issues: ImageQualityIssue[] = [];

  // 1. ファイルサイズ
  const fileSize = blob.size;
  if (fileSize > MAX_FILE_SIZE_BYTES) {
    issues.push('too_large');
  }

  // 2. 形式チェック
  if (!isSupportedImageType(blob.type)) {
    issues.push('unsupported_format');
  }

  // 3. ブラウザ環境のみ: ピクセル解析
  let laplacianVariance = 0;
  let meanBrightness = 128;
  let aspectRatio = 1;

  if (typeof window !== 'undefined' && isSupportedImageType(blob.type)) {
    try {
      const imageData = await blobToImageData(blob);
      laplacianVariance = calculateLaplacianVariance(imageData);
      meanBrightness = calculateMeanBrightness(imageData);
      aspectRatio = imageData.width / imageData.height;

      if (laplacianVariance < BLUR_THRESHOLD) {
        issues.push('too_blurry');
      }
      if (meanBrightness < DARKNESS_THRESHOLD) {
        issues.push('too_dark');
      }
      if (aspectRatio < 0.3 || aspectRatio > 3.0) {
        issues.push('extreme_aspect_ratio');
      }
    } catch {
      // ピクセル解析失敗は warning とせず素通り
      // (Vision API 側で is_readable=false が返るのを待つ)
    }
  }

  return {
    laplacian_variance: laplacianVariance,
    mean_brightness: meanBrightness,
    file_size_bytes: fileSize,
    aspect_ratio: aspectRatio,
    issues,
  };
}

/**
 * 品質チェック結果をユーザー向けメッセージに変換。
 */
export function describeQualityIssues(issues: ImageQualityIssue[]): string[] {
  const messages: string[] = [];
  for (const issue of issues) {
    switch (issue) {
      case 'too_blurry':
        messages.push('写真がブレています。ピントを合わせて撮り直してください。');
        break;
      case 'too_dark':
        messages.push('写真が暗いです。明るい場所で撮り直してください。');
        break;
      case 'too_large':
        messages.push('ファイルサイズが大きすぎます。自動で圧縮します。');
        break;
      case 'extreme_aspect_ratio':
        messages.push('ページ全体が写るように撮り直してください。');
        break;
      case 'unsupported_format':
        messages.push('対応していない画像形式です (JPEG/PNG/WebP のいずれかで撮ってください)。');
        break;
    }
  }
  return messages;
}

/** 重大な問題があり、API 送信を中止すべきか */
export function hasCriticalIssue(check: LocalImageQualityCheck): boolean {
  return (
    check.issues.includes('too_blurry') ||
    check.issues.includes('extreme_aspect_ratio') ||
    check.issues.includes('unsupported_format')
  );
}

// ============================================================================
// 圧縮 (5MB 超 or 1600px 超を JPEG q=0.85 に縮小)
// ============================================================================

/**
 * 必要に応じて画像を圧縮。ブラウザ専用 (Canvas + toBlob)。
 *
 * @param blob          元画像
 * @param maxDimension  長辺の最大値 (デフォルト 1600px)
 * @param quality       JPEG 品質 (デフォルト 0.85)
 */
export async function compressIfNeeded(
  blob: Blob,
  maxDimension: number = MAX_IMAGE_DIMENSION,
  quality: number = 0.85
): Promise<Blob> {
  if (typeof window === 'undefined') {
    return blob; // Node 環境では圧縮しない
  }

  const img = await blobToImage(blob);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const needsResize = Math.max(w, h) > maxDimension;
  const needsRecompress = blob.size > MAX_FILE_SIZE_BYTES;

  if (!needsResize && !needsRecompress && blob.type === 'image/jpeg') {
    return blob;
  }

  const scale = needsResize ? maxDimension / Math.max(w, h) : 1;
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D canvas context for compression');
  }
  ctx.drawImage(img, 0, 0, newW, newH);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (resultBlob) => {
        if (!resultBlob) {
          reject(new Error('Canvas.toBlob returned null'));
          return;
        }
        resolve(resultBlob);
      },
      'image/jpeg',
      quality
    );
  });
}

// ============================================================================
// 補助
// ============================================================================

function isSupportedImageType(mimeType: string): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType);
}

/**
 * Blob を base64 文字列に変換 (Vision API 送信用)。
 * ブラウザ・Node 両対応。
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof window !== 'undefined' && typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // "data:image/jpeg;base64,XXXX" の prefix を削除
        const base64 = result.split(',')[1] ?? '';
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(blob);
    });
  }

  // Node fallback (Buffer)
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}
