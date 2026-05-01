/**
 * 空間推論ユーティリティ - 座標変換と HITL UI 用オーバーレイ生成
 *
 * Gemini Vision API は box_2d を [ymin, xmin, ymax, xmax] (0-1000 正規化) で返す。
 * このモジュールでは:
 * - 正規化座標 → 絶対座標 (px) の逆スケール (descale)
 * - 絶対座標 → 正規化座標の順スケール (scale, HITL 修正後の再送信用)
 * - VisionAnalysisResult からオーバーレイ描画情報を生成
 *
 * 詳細仕様: skills/vision-api-spec.md (5. 座標逆スケール仕様)
 */

import type {
  NormalizedBoundingBox,
  AbsoluteBoundingBox,
  StumblingPoint,
  VisionAnalysisResult,
  BoundingBoxOverlay,
} from '../types/vision';
import { CONFIDENCE_THRESHOLD_HITL } from '../types/vision';
import { isMeaningfulBoundingBox } from './json-schema';

// ============================================================================
// 例外型
// ============================================================================

export class SpatialReasoningError extends Error {
  constructor(message: string) {
    super(`[SpatialReasoning] ${message}`);
    this.name = 'SpatialReasoningError';
  }
}

// ============================================================================
// バリデーション
// ============================================================================

function assertImageDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new SpatialReasoningError(`Invalid image dimensions: ${width}x${height}`);
  }
  if (width <= 0 || height <= 0) {
    throw new SpatialReasoningError(`Image dimensions must be positive: ${width}x${height}`);
  }
}

function assertNormalizedBox(box: NormalizedBoundingBox): void {
  if (!Array.isArray(box) || box.length !== 4) {
    throw new SpatialReasoningError('Normalized box must be [ymin, xmin, ymax, xmax]');
  }
  for (const v of box) {
    if (!Number.isInteger(v) || v < 0 || v > 1000) {
      throw new SpatialReasoningError(
        `Normalized box values must be integers in [0, 1000], got: ${box.join(', ')}`
      );
    }
  }
  const [ymin, xmin, ymax, xmax] = box;
  if (ymin >= ymax || xmin >= xmax) {
    throw new SpatialReasoningError(
      `Normalized box order invalid: ymin=${ymin}, xmin=${xmin}, ymax=${ymax}, xmax=${xmax}`
    );
  }
}

function assertAbsoluteBox(box: AbsoluteBoundingBox, imageWidth: number, imageHeight: number): void {
  if (box.x < 0 || box.y < 0) {
    throw new SpatialReasoningError(`Absolute box has negative origin: x=${box.x}, y=${box.y}`);
  }
  if (box.width <= 0 || box.height <= 0) {
    throw new SpatialReasoningError(
      `Absolute box must have positive size: width=${box.width}, height=${box.height}`
    );
  }
  if (box.x + box.width > imageWidth || box.y + box.height > imageHeight) {
    throw new SpatialReasoningError(
      `Absolute box exceeds image bounds: ` +
        `box=(${box.x},${box.y},${box.width},${box.height}), image=${imageWidth}x${imageHeight}`
    );
  }
}

// ============================================================================
// 逆スケール: 正規化 → 絶対 (Vision API → クライアント描画)
// ============================================================================

/**
 * Gemini API の正規化座標 [ymin, xmin, ymax, xmax] (0-1000) を、
 * 実際の画像ピクセル座標に変換する。
 *
 * @param normalizedBox  Gemini が返す box_2d
 * @param imageWidth     画像の幅 (px)
 * @param imageHeight    画像の高さ (px)
 * @returns              絶対座標 { x, y, width, height }
 */
export function descaleBoundingBox(
  normalizedBox: NormalizedBoundingBox,
  imageWidth: number,
  imageHeight: number
): AbsoluteBoundingBox {
  assertImageDimensions(imageWidth, imageHeight);
  assertNormalizedBox(normalizedBox);

  const [ymin, xmin, ymax, xmax] = normalizedBox;

  const x = Math.floor((xmin / 1000) * imageWidth);
  const y = Math.floor((ymin / 1000) * imageHeight);
  // floor(end) - floor(start) で 1px のずれが起きないように、end を別計算
  const xEnd = Math.floor((xmax / 1000) * imageWidth);
  const yEnd = Math.floor((ymax / 1000) * imageHeight);
  const width = Math.max(1, xEnd - x);
  const height = Math.max(1, yEnd - y);

  return { x, y, width, height };
}

// ============================================================================
// 順スケール: 絶対 → 正規化 (HITL 修正後 API へ再送信用)
// ============================================================================

/**
 * 絶対座標を Gemini API の正規化座標に戻す。
 * HITL UI でユーザーが箱を調整した後、再解析リクエストに使う。
 */
export function scaleBoundingBox(
  absoluteBox: AbsoluteBoundingBox,
  imageWidth: number,
  imageHeight: number
): NormalizedBoundingBox {
  assertImageDimensions(imageWidth, imageHeight);
  assertAbsoluteBox(absoluteBox, imageWidth, imageHeight);

  const xmin = Math.round((absoluteBox.x / imageWidth) * 1000);
  const ymin = Math.round((absoluteBox.y / imageHeight) * 1000);
  const xmax = Math.round(((absoluteBox.x + absoluteBox.width) / imageWidth) * 1000);
  const ymax = Math.round(((absoluteBox.y + absoluteBox.height) / imageHeight) * 1000);

  // クランプ + 順序保証
  const safe = (v: number) => Math.max(0, Math.min(1000, v));
  const out: NormalizedBoundingBox = [safe(ymin), safe(xmin), safe(ymax), safe(xmax)];
  assertNormalizedBox(out);
  return out;
}

// ============================================================================
// オーバーレイ生成 (HITL UI 用)
// ============================================================================

/**
 * VisionAnalysisResult から HITL UI 用のオーバーレイ描画情報を生成。
 *
 * フィルタリング:
 * - 意味のないサイズの箱 (面積 < 0.5% or > 80%) は除外
 *
 * 信頼度に応じた表示の出し分けは UI 側 (BoundingBoxOverlay.confidence を参照)。
 */
export function createOverlaysFromVisionResult(
  result: VisionAnalysisResult,
  imageWidth: number,
  imageHeight: number
): BoundingBoxOverlay[] {
  return result.stumbling_points
    .filter((p) => isMeaningfulBoundingBox(p.box_2d))
    .map((p): BoundingBoxOverlay => ({
      mark_id: p.mark_id,
      absolute_box: descaleBoundingBox(p.box_2d, imageWidth, imageHeight),
      mark_type: p.mark_type,
      confidence: p.confidence ?? 0.5,
      user_confirmed: false,
    }));
}

/**
 * 信頼度が低いオーバーレイ (HITL 確認が推奨されるもの) を抽出。
 */
export function filterLowConfidenceOverlays(
  overlays: BoundingBoxOverlay[],
  threshold: number = CONFIDENCE_THRESHOLD_HITL
): BoundingBoxOverlay[] {
  return overlays.filter((o) => o.confidence < threshold);
}

// ============================================================================
// HITL: ユーザー調整の反映
// ============================================================================

/**
 * HITL UI でユーザーが箱を調整した結果を BoundingBoxOverlay に反映。
 */
export function applyUserAdjustment(
  overlay: BoundingBoxOverlay,
  newAbsoluteBox: AbsoluteBoundingBox
): BoundingBoxOverlay {
  return {
    ...overlay,
    user_adjusted_box: newAbsoluteBox,
    user_confirmed: true,
  };
}

/**
 * HITL UI でユーザーが「合ってる」と確認したことを反映 (位置調整なし)。
 */
export function confirmOverlay(overlay: BoundingBoxOverlay): BoundingBoxOverlay {
  return { ...overlay, user_confirmed: true };
}

// ============================================================================
// HITL 反映後の再構成
// ============================================================================

/**
 * HITL UI のオーバーレイ群を、Vision API へ再送信可能な StumblingPoint[] に再構成。
 * - user_adjusted_box があればそれを正規化座標に戻して採用
 * - 確認済みのみを返す
 */
export function rebuildStumblingPointsFromOverlays(
  overlays: BoundingBoxOverlay[],
  originalPoints: StumblingPoint[],
  imageWidth: number,
  imageHeight: number
): StumblingPoint[] {
  const byId = new Map(originalPoints.map((p) => [p.mark_id, p]));

  return overlays
    .filter((o) => o.user_confirmed)
    .map((o) => {
      const original = byId.get(o.mark_id);
      if (!original) {
        throw new SpatialReasoningError(
          `No original StumblingPoint found for mark_id=${o.mark_id}`
        );
      }
      const box = o.user_adjusted_box
        ? scaleBoundingBox(o.user_adjusted_box, imageWidth, imageHeight)
        : original.box_2d;
      return { ...original, box_2d: box };
    });
}

// ============================================================================
// 補助: 重なり判定 (近接マーク統合用、将来拡張)
// ============================================================================

/**
 * 2 つのバウンディングボックスの IoU (Intersection over Union) を計算。
 * 0.0 = 重なりなし、1.0 = 完全一致
 */
export function computeIoU(
  a: NormalizedBoundingBox,
  b: NormalizedBoundingBox
): number {
  const [ay1, ax1, ay2, ax2] = a;
  const [by1, bx1, by2, bx2] = b;

  const interY1 = Math.max(ay1, by1);
  const interX1 = Math.max(ax1, bx1);
  const interY2 = Math.min(ay2, by2);
  const interX2 = Math.min(ax2, bx2);

  if (interY2 <= interY1 || interX2 <= interX1) {
    return 0;
  }

  const interArea = (interY2 - interY1) * (interX2 - interX1);
  const aArea = (ay2 - ay1) * (ax2 - ax1);
  const bArea = (by2 - by1) * (bx2 - bx1);
  const unionArea = aArea + bArea - interArea;

  return interArea / unionArea;
}

/**
 * 重複 (IoU > threshold) するマークをマージ。
 * confidence が高い方を残す。
 */
export function mergeOverlappingPoints(
  points: StumblingPoint[],
  iouThreshold: number = 0.7
): StumblingPoint[] {
  const sorted = [...points].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
  );
  const kept: StumblingPoint[] = [];

  for (const p of sorted) {
    const overlaps = kept.some((k) => computeIoU(p.box_2d, k.box_2d) > iouThreshold);
    if (!overlaps) {
      kept.push(p);
    }
  }

  return kept;
}
