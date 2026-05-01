/**
 * Gemini Vision API 型定義
 *
 * Research Prompt 4: マルチモーダルAIによるソクラテス式学習支援パイプライン
 * 詳細仕様: skills/vision-api-spec.md
 */

// ============================================================================
// Document Metadata
// ============================================================================

/** 教科の識別子 (Vision API レスポンス内で使用) */
export type SubjectName =
  | '国語'
  | '算数'
  | '理科'
  | '社会'
  | '英語'
  | '生活'
  | '不明';

/** ページの種類 */
export type PageType =
  | 'textbook'
  | 'workbook'
  | 'notebook'
  | 'test'
  | 'unknown';

/** 文書メタデータ */
export interface DocumentMetadata {
  subject: SubjectName;
  unit_name: string;
  /** 学年推定。不明な場合は 0 */
  grade_estimate?: number;
  page_type?: PageType;
}

// ============================================================================
// Stumbling Points (つまずきポイント)
// ============================================================================

/** 手書き記号の種類 */
export type HandwrittenMarkType =
  | 'circle'         // ○ : 強調・未知の語彙
  | 'underline'      // _ : 重要箇所
  | 'question_mark'  // ? : 明示的な疑問
  | 'cross'          // × : 不正解
  | 'triangle'       // △ : 部分的に理解
  | 'tick';          // ✓ : 日本では「要確認」

/**
 * Gemini Vision API が返す正規化座標
 * 形式: [ymin, xmin, ymax, xmax]
 * 各値は 0-1000 に正規化されている (画像サイズ非依存)
 */
export type NormalizedBoundingBox = [number, number, number, number];

/**
 * クライアント側で逆スケール後の絶対座標
 * 単位はピクセル
 */
export interface AbsoluteBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** つまずきポイント (Vision API レスポンス内の各検出項目) */
export interface StumblingPoint {
  /** 一意ID (例: mark-001) */
  mark_id: string;
  /** 手書き記号の種類 */
  mark_type: HandwrittenMarkType;
  /** 正規化座標 [ymin, xmin, ymax, xmax] (0-1000) */
  box_2d: NormalizedBoundingBox;
  /** マークが囲んでいるテキスト・数式・単語 */
  extracted_problem: string;
  /** 教育概念 (例: '分数の割り算', '光の屈折') */
  identified_concept: string;
  /** 認知的に何が問題か (質的分析) */
  cognitive_issue: string;
  /** AI 認識信頼度 (0-1)。0.7 未満は HITL 確認推奨 */
  confidence?: number;
}

// ============================================================================
// Image Quality
// ============================================================================

/** Vision API が判定した画像品質 */
export interface ImageQualityAssessment {
  /** 学習教材か (false なら拒否) */
  is_educational_content: boolean;
  /** 文字が読み取れるか */
  is_readable: boolean;
  /** 警告 (例: 'image is slightly blurry', 'low contrast') */
  warnings?: string[];
}

/** クライアント側ローカル品質チェック結果 */
export interface LocalImageQualityCheck {
  /** ラプラシアン分散 (高いほど鮮明、< 100 でブレ判定) */
  laplacian_variance: number;
  /** 平均輝度 (0-255、< 50 で暗すぎ判定) */
  mean_brightness: number;
  /** ファイルサイズ (バイト) */
  file_size_bytes: number;
  /** アスペクト比 (width / height) */
  aspect_ratio: number;
  /** 検出された問題 */
  issues: ImageQualityIssue[];
}

export type ImageQualityIssue =
  | 'too_blurry'
  | 'too_dark'
  | 'too_large'
  | 'extreme_aspect_ratio'
  | 'unsupported_format';

// ============================================================================
// Vision API Result
// ============================================================================

/** Vision API の最終レスポンス (response_schema に対応) */
export interface VisionAnalysisResult {
  document_metadata: DocumentMetadata;
  stumbling_points: StumblingPoint[];
  image_quality: ImageQualityAssessment;
}

// ============================================================================
// Socratic Dialogue State
// ============================================================================

/** ソクラテス式対話のモード */
export type SocraticMode =
  | 'exploratory'   // 初期: 児童の現状理解を確認
  | 'details'       // 児童が抽象的に答えた → 具体化を求める
  | 'scaffolding';  // 児童が行き詰まり → 類題・アナロジー提示

/** 児童の発話分類 */
export type ChildResponseClassification =
  | 'vague'      // 曖昧 (「分からない」「なんとなく」)
  | 'concrete'   // 具体的 (数値や用語を含む)
  | 'stuck'      // 完全に詰まっている
  | 'correct'    // 概念を理解できている
  | 'partial';   // 部分的に正しい

/** 児童の発話履歴 1 件 */
export interface ChildResponseRecord {
  turn: number;
  content: string;
  classified_as: ChildResponseClassification;
  timestamp: number;
}

/** ソクラテス式対話の状態 */
export interface SocraticDialogueState {
  session_id: string;
  /** 紐づく StumblingPoint.mark_id */
  stumbling_point_id: string;
  /** 現在のモード */
  mode: SocraticMode;
  /** 何ターン目か */
  turn_count: number;
  /** 児童の発話履歴 */
  child_response_history: ChildResponseRecord[];
  /** 児童の概念理解度 (0-1) */
  concept_understanding_score: number;
  /** 次の質問戦略 */
  next_question_strategy: 'deepen' | 'broaden' | 'simplify' | 'conclude';
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/** Vision API リクエスト (内部表現) */
export interface VisionRequest {
  /** Base64 エンコード済み画像データ */
  image_base64: string;
  /** MIME type (例: 'image/jpeg', 'image/png') */
  mime_type: string;
  /** 教科ヒント (任意、プロンプトに教科別指示を追加) */
  subject_hint?: SubjectName;
  /** ユーザー追加コンテキスト (任意) */
  user_context?: string;
  /** 教師 / 学生のロール (権限ベースのスコープ調整) */
  role?: 'student' | 'teacher' | 'parent';
}

/** Vision API リクエスト時のオプション */
export interface VisionRequestOptions {
  /** モデル名 (デフォルト: gemini-3.1-pro-vision) */
  model?: string;
  /** Temperature (デフォルト: 0.1) */
  temperature?: number;
  /** 最大出力トークン (デフォルト: 4096) */
  max_output_tokens?: number;
  /** リトライ回数 (デフォルト: 3) */
  max_retries?: number;
  /** タイムアウト ms (デフォルト: 30000) */
  timeout_ms?: number;
}

/** API クライアントが返す統一レスポンス */
export interface VisionApiResponse {
  /** 解析結果 */
  result: VisionAnalysisResult;
  /** 使用したモデル */
  model_used: string;
  /** 入力トークン数 */
  input_tokens?: number;
  /** 出力トークン数 */
  output_tokens?: number;
  /** キャッシュヒットしたか */
  cache_hit?: boolean;
  /** 処理にかかった時間 (ms) */
  processing_time_ms: number;
}

// ============================================================================
// Local Cache
// ============================================================================

/** ローカル画像キャッシュの 1 エントリ */
export interface LocalImageCacheEntry {
  /** 画像の SHA-256 ハッシュ */
  hash: string;
  /** 解析結果 */
  vision_result: VisionAnalysisResult;
  /** キャッシュ作成時刻 (Unix ms) */
  cached_at: number;
  /** TTL (ms) */
  ttl_ms: number;
}

// ============================================================================
// Pattern Analyzer 統合用
// ============================================================================

/**
 * Vision の結果を pattern-analyzer.ts に渡すための変換型
 * (types/analysis.ts の MasteryMap と整合させる)
 */
export interface VisionMasteryUpdate {
  subject: SubjectName;
  unit_name: string;
  stumbling_count: number;
  identified_concepts: string[];
  cognitive_issues: string[];
  analyzed_at: number;
}

// ============================================================================
// HITL UI 用
// ============================================================================

/** HITL 確認のためのオーバーレイ描画情報 */
export interface BoundingBoxOverlay {
  mark_id: string;
  /** 絶対座標 (px) */
  absolute_box: AbsoluteBoundingBox;
  /** 表示する記号タイプ */
  mark_type: HandwrittenMarkType;
  /** 信頼度 (低いほど目立つ色で表示) */
  confidence: number;
  /** ユーザーが確認済みか */
  user_confirmed: boolean;
  /** ユーザーが手動で調整した結果 */
  user_adjusted_box?: AbsoluteBoundingBox;
}

// ============================================================================
// Constants
// ============================================================================

/** デフォルトの Vision モデル */
export const DEFAULT_VISION_MODEL = 'gemini-3.1-pro-vision';

/** チャット段階の軽量モデル */
export const DEFAULT_CHAT_MODEL = 'gemini-3.1-flash-lite';

/** デフォルト温度 (情報抽出向け) */
export const DEFAULT_TEMPERATURE = 0.1;

/** HITL 確認推奨の信頼度閾値 */
export const CONFIDENCE_THRESHOLD_HITL = 0.7;

/** ブレ判定の閾値 (ラプラシアン分散) */
export const BLUR_THRESHOLD = 100;

/** 暗さ判定の閾値 (平均輝度) */
export const DARKNESS_THRESHOLD = 50;

/** ファイルサイズ上限 (5 MB) */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** 画像の最大長辺 (px) - 圧縮時の上限 */
export const MAX_IMAGE_DIMENSION = 1600;

/** ローカルキャッシュ TTL (1 時間) */
export const LOCAL_CACHE_TTL_MS = 60 * 60 * 1000;
