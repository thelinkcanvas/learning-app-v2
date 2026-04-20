/**
 * パターン分析エンジン V2 - 型定義
 *
 * 6種類のエラーパターン検出・個別化学習提案・週間レポートに必要な型を定義
 */

// ============================================================================
// Message with Timestamp (分析用拡張メッセージ)
// ============================================================================

/**
 * タイムスタンプ付きメッセージ
 * MVP の GeminiMessage に timestamp を追加した形式
 */
export interface TimestampedMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO 8601 format
}

// ============================================================================
// Pattern Types (6種類のパターン)
// ============================================================================

/**
 * 検出対象パターンの種類
 */
export type PatternType =
  | 'repetition'          // Pattern A: 同一質問の繰り返し
  | 'failure-success'     // Pattern B: 失敗→成功の遷移
  | 'mastery'             // Pattern C: 教科別得意・苦手分野
  | 'confidence-decline'  // Pattern D: 確信度低下（集中力低下）
  | 'hint-dependency'     // Pattern E: ヒント要求頻度
  | 'fluency';            // Pattern F: 学習流暢性

/**
 * パターン検出結果の深刻度
 */
export type PatternSeverity = 'low' | 'medium' | 'high';

/**
 * 単一のパターン検出結果
 */
export interface AnalysisPattern {
  type: PatternType;
  confidence: number;       // 0-1 (検出確信度)
  topic: string;            // 対象トピック（例: "繰り上がり"）
  occurrences: number;      // 発生回数
  timeSpan?: string;        // タイムスパン（例: "142分"）
  severity: PatternSeverity;
  recommendation?: string;  // 推奨アクション
  evidence?: string[];      // 根拠メッセージ（デバッグ用）
}

// ============================================================================
// Pattern A: Repetition
// ============================================================================

export interface RepetitionPattern extends AnalysisPattern {
  type: 'repetition';
  keywords: string[];       // 共通キーワード
  intervals: number[];      // 発生間隔（分）
  classification: 'immediate' | 'review'; // 5分以内 vs 1時間以上
}

// ============================================================================
// Pattern B: Failure-Success Transition
// ============================================================================

export interface FailureSuccessTransition extends AnalysisPattern {
  type: 'failure-success';
  failureCount: number;     // 失敗回数
  successAt: string;        // 成功した時刻
  masteryTime: string;      // 習得所要時間（例: "3分"）
}

// ============================================================================
// Pattern C: Subject Mastery
// ============================================================================

export interface UnitMastery {
  rate: number;             // 成功率 0-1
  attempts: number;         // 試行回数
  trend: 'improving' | 'stable' | 'declining';
  lastAttempt?: string;     // 最終試行日時
}

export type MasteryMap = Record<string, UnitMastery>;

export interface SubjectMasteryPattern extends AnalysisPattern {
  type: 'mastery';
  subjectMap: MasteryMap;
  strengths: string[];      // 得意分野（成功率 >= 80%）
  weaknesses: string[];     // 苦手分野（成功率 < 60%）
}

// ============================================================================
// Pattern D: Confidence Decline
// ============================================================================

export interface ConfidenceMetrics extends AnalysisPattern {
  type: 'confidence-decline';
  avgMessageLengthTrend: number[]; // 時系列での平均文字数
  failureRateChange: number;       // 失敗率の変化（前半 vs 後半）
  declineDetected: boolean;
  timestamp?: string;              // 低下検出時刻
}

// ============================================================================
// Pattern E: Hint Dependency
// ============================================================================

export interface HintDependencyScore extends AnalysisPattern {
  type: 'hint-dependency';
  hintRequests: number;      // ヒント要求数
  totalQuestions: number;    // 総質問数
  dependencyRate: number;    // 依存率 0-1
  style: 'autonomous' | 'balanced' | 'dependent';
}

// ============================================================================
// Pattern F: Learning Fluency
// ============================================================================

export interface FluencyMetrics extends AnalysisPattern {
  type: 'fluency';
  topicTurnCounts: Record<string, number>; // トピック別ターン数
  avgTurnsToSuccess: number;
  quickLearnTopics: string[];  // 3ターン以内で習得
  slowLearnTopics: string[];   // 10ターン以上必要
}

// ============================================================================
// Daily Analysis Result
// ============================================================================

/**
 * 1日分の分析結果
 */
export interface DailyAnalysisResult {
  date: string;                      // YYYY-MM-DD
  subject: string;                   // 教科（math, japanese, science, social）
  childId?: string;                  // 子どもID（複数対応時）
  patterns: AnalysisPattern[];       // 検出された全パターン
  masteryByUnit: MasteryMap;         // 単元別マスタリー
  overallProgress: string;           // 総合進度コメント
  recommendedActions: string[];      // 推奨アクション
  generatedAt: string;               // 生成時刻 ISO 8601
  messageCount: number;              // 対象メッセージ数
}

// ============================================================================
// Weekly Report Data
// ============================================================================

/**
 * 教科ごとの週間分析
 */
export interface SubjectWeeklyAnalysis {
  subject: string;
  successRateChange: string;                    // 前週比（例: "+5%"）
  topicPerformance: Record<string, {
    weekStart: number;
    weekEnd: number;
    trend: 'improving' | 'stable' | 'declining';
  }>;
  estimatedMasteryDate?: string;                // 習得予想日
  recommendations: string[];                    // 推奨アクション
}

/**
 * 親向けガイダンス
 */
export interface ParentGuidanceContent {
  whatToFocus: string;          // 重点分野
  howToSupport: string;         // サポート方法
  timelineToMastery: string;    // 習得までの予想期間
  estimatedNextUnit?: string;   // 次の推奨単元
  concreteResources?: string[]; // 具体的なリソース（教材・動画等）
}

/**
 * 週間レポート
 */
export interface WeeklyReportData {
  week: string;                                      // 期間（例: "2026-04-13〜2026-04-19"）
  subjects: Record<string, SubjectWeeklyAnalysis>;   // 教科別分析
  overallGrowthAssessment: string;                   // 総合成長評価
  parentGuidance: ParentGuidanceContent;             // 親向けガイダンス
  generatedAt: string;                               // 生成時刻
}

// ============================================================================
// Analysis Engine Config
// ============================================================================

/**
 * パターン分析エンジンの設定
 */
export interface AnalyzerConfig {
  // Pattern A: Repetition
  repetitionThreshold: number;        // 検出閾値（デフォルト: 3回）
  immediateIntervalMinutes: number;   // 即時繰り返しの閾値（デフォルト: 5分）

  // Pattern C: Mastery
  strengthThreshold: number;          // 得意分野の成功率閾値（デフォルト: 0.8）
  weaknessThreshold: number;          // 苦手分野の成功率閾値（デフォルト: 0.6）

  // Pattern D: Confidence
  messageLengthDeclineRatio: number;  // 文字数低下比率（デフォルト: 0.5）

  // Pattern E: Hint Dependency
  hintDependencyThreshold: number;    // 依存型と判定する閾値（デフォルト: 0.7）

  // Pattern F: Fluency
  quickLearnTurnsMax: number;         // 速習トピックの最大ターン数（デフォルト: 3）
  slowLearnTurnsMin: number;          // 遅習トピックの最小ターン数（デフォルト: 10）
}

/**
 * デフォルト設定
 */
export const DEFAULT_ANALYZER_CONFIG: AnalyzerConfig = {
  repetitionThreshold: 3,
  immediateIntervalMinutes: 5,
  strengthThreshold: 0.8,
  weaknessThreshold: 0.6,
  messageLengthDeclineRatio: 0.5,
  hintDependencyThreshold: 0.7,
  quickLearnTurnsMax: 3,
  slowLearnTurnsMin: 10,
};

// ============================================================================
// Message Classification (内部ユーティリティ用)
// ============================================================================

/**
 * Gemini の応答を成功/失敗/中立に分類
 */
export type MessageClassification = 'success' | 'failure' | 'neutral';

/**
 * 成功を示すキーワード（Geminiの褒め言葉）
 */
export const SUCCESS_KEYWORDS = [
  'その通り',
  'すごい',
  '正解',
  '完璧',
  'よくできた',
  'よくわかったね',
  'バッチリ',
  'すばらしい',
  '✨',
  '👍',
  '🎉',
];

/**
 * 失敗を示すキーワード（Geminiのヒント誘導）
 */
export const FAILURE_KEYWORDS = [
  'もう一度',
  'ちょっと違う',
  'もう少し考えて',
  'ヒントをあげよう',
  'うーん',
  '惜しい',
  'もうちょっと',
];

/**
 * ヒント要求を示すキーワード（ユーザーの質問）
 */
export const HINT_REQUEST_KEYWORDS = [
  'わからない',
  'わかりません',
  'ヒント',
  '教えて',
  'ヘルプ',
  'やり方',
  'どうやって',
  '難しい',
];
