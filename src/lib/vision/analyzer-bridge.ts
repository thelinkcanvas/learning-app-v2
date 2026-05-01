/**
 * Vision API → pattern-analyzer.ts ブリッジ
 *
 * 役割:
 * - VisionAnalysisResult を MasteryMap (types/analysis.ts) に統合
 * - 「つまずきが検出された」イベントを学習試行 (attempts) として記録
 * - 単元名 (unit_name) をキーとして使い、過去の試行率と統合
 *
 * 設計の重要点:
 * - Vision の検出は「つまずき = 失敗試行」とみなす
 * - 同じ単元で複数のマークがあっても 1 試行として集約
 * - rate (成功率) は新規追加せず、attempts のみ加算 (失敗扱い)
 *
 * 詳細仕様: skills/vision-api-spec.md (9. pattern-analyzer.ts との統合)
 */

import type {
  VisionAnalysisResult,
  VisionMasteryUpdate,
  SubjectName,
} from '../types/vision';
import type { MasteryMap } from '../types/analysis';
import { filterMeaningfulStumblingPoints } from './json-schema';

// ============================================================================
// 単純変換: VisionAnalysisResult → VisionMasteryUpdate
// ============================================================================

/**
 * Vision の結果を pattern-analyzer 連携用の中間形式に変換。
 *
 * - 意味のないボックスは除外
 * - identified_concept と cognitive_issue を集約
 */
export function visionToMasteryUpdate(
  vision: VisionAnalysisResult
): VisionMasteryUpdate {
  const meaningful = filterMeaningfulStumblingPoints(vision.stumbling_points);

  return {
    subject: vision.document_metadata.subject,
    unit_name: vision.document_metadata.unit_name,
    stumbling_count: meaningful.length,
    identified_concepts: dedupe(meaningful.map((p) => p.identified_concept)),
    cognitive_issues: dedupe(meaningful.map((p) => p.cognitive_issue)),
    analyzed_at: Date.now(),
  };
}

// ============================================================================
// MasteryMap への統合
// ============================================================================

/**
 * Vision で検出されたつまずきを、既存の MasteryMap に統合する。
 *
 * ロジック:
 * - unit_name が既存にあれば: attempts +1 (失敗試行として加算)、rate を再計算
 * - 新規 unit なら: 初期エントリ作成 (rate=0, attempts=1, trend='declining')
 *
 * trend の決定:
 * - 過去の rate が 0.5 以上 → 'declining' (理解していたのに困っている = 後退)
 * - 過去の rate が 0.5 未満 → 'stable' (もともと苦手)
 *
 * @param existing  既存の MasteryMap
 * @param vision    Vision API の解析結果
 * @returns         統合済みの MasteryMap (新インスタンス)
 */
export function mergeVisionIntoMastery(
  existing: MasteryMap,
  vision: VisionAnalysisResult
): MasteryMap {
  const update = visionToMasteryUpdate(vision);

  // つまずきが 0 件 (educational content だが○なし) → 何もしない
  if (update.stumbling_count === 0) {
    return existing;
  }

  const merged: MasteryMap = { ...existing };
  const key = update.unit_name;
  const prev = existing[key];

  if (prev) {
    // 既存単元: 失敗 1 として加算
    const newAttempts = prev.attempts + 1;
    const successCount = prev.rate * prev.attempts;
    const newRate = successCount / newAttempts; // 失敗が増えた分 rate 低下
    merged[key] = {
      rate: newRate,
      attempts: newAttempts,
      trend: prev.rate >= 0.5 ? 'declining' : 'stable',
      lastAttempt: new Date(update.analyzed_at).toISOString(),
    };
  } else {
    // 新規単元: 失敗試行 1 として記録
    merged[key] = {
      rate: 0,
      attempts: 1,
      trend: 'stable',
      lastAttempt: new Date(update.analyzed_at).toISOString(),
    };
  }

  return merged;
}

/**
 * 「セッション完了 (成功)」を mastery に反映するヘルパー。
 *
 * Vision で検出されたつまずきを児童が解決した時に呼ぶ。
 * - rate を上方修正
 * - trend を 'improving' に
 */
export function recordSuccessForUnit(
  existing: MasteryMap,
  unitName: string
): MasteryMap {
  const merged: MasteryMap = { ...existing };
  const prev = existing[unitName];

  if (prev) {
    const newAttempts = prev.attempts + 1;
    const successCount = prev.rate * prev.attempts + 1;
    const newRate = successCount / newAttempts;
    merged[unitName] = {
      rate: newRate,
      attempts: newAttempts,
      trend: newRate > prev.rate ? 'improving' : 'stable',
      lastAttempt: new Date().toISOString(),
    };
  } else {
    merged[unitName] = {
      rate: 1,
      attempts: 1,
      trend: 'improving',
      lastAttempt: new Date().toISOString(),
    };
  }

  return merged;
}

// ============================================================================
// 集計: 直近の傾向分析
// ============================================================================

export interface VisionMasterySummary {
  subject: SubjectName;
  total_units_seen: number;
  units_with_stumbles: string[];
  most_recent_unit: string | null;
  most_recent_concepts: string[];
  weakness_units: string[];   // rate < 0.6
  strength_units: string[];   // rate >= 0.8
}

/**
 * Vision 由来の MasteryMap から、教科ごとのサマリーを抽出。
 * (UI 表示・親通知用)
 */
export function summarizeVisionMastery(
  mastery: MasteryMap,
  subject: SubjectName,
  recentVision?: VisionAnalysisResult
): VisionMasterySummary {
  const units = Object.entries(mastery);
  const weaknessUnits = units
    .filter(([, m]) => m.rate < 0.6 && m.attempts >= 2)
    .map(([k]) => k);
  const strengthUnits = units
    .filter(([, m]) => m.rate >= 0.8 && m.attempts >= 2)
    .map(([k]) => k);

  const stumbleUnits = units
    .filter(([, m]) => m.rate < 1 && m.attempts >= 1)
    .map(([k]) => k);

  return {
    subject,
    total_units_seen: units.length,
    units_with_stumbles: stumbleUnits,
    most_recent_unit: recentVision?.document_metadata.unit_name ?? null,
    most_recent_concepts: recentVision
      ? dedupe(recentVision.stumbling_points.map((p) => p.identified_concept))
      : [],
    weakness_units: weaknessUnits,
    strength_units: strengthUnits,
  };
}

// ============================================================================
// 補助
// ============================================================================

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// ============================================================================
// 型再エクスポート (ブリッジ層を使う側の便宜)
// ============================================================================

export type { MasteryMap, UnitMastery } from '../types/analysis';
export type { VisionMasteryUpdate } from '../types/vision';
