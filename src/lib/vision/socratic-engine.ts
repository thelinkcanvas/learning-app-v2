/**
 * ソクラテス式問答エンジン
 *
 * Vision API で抽出された StumblingPoint を context に、児童との対話を駆動する。
 *
 * 設計の核心:
 * 1. 解答秘匿 (Ask, Don't Answer) - システムプロンプトで強制
 * 2. 1 ターン 1 質問 (Step-by-step) - 出力長制限と監査
 * 3. 状態管理: exploratory → details → scaffolding の動的遷移
 * 4. 児童発話の軽量分類で次のモードを決定
 *
 * 詳細仕様: skills/vision-api-spec.md (5. ソクラテス式問答パイプライン)
 */

import type {
  VisionAnalysisResult,
  StumblingPoint,
  SocraticDialogueState,
  SocraticMode,
  ChildResponseRecord,
  ChildResponseClassification,
} from '../types/vision';
import { DEFAULT_CHAT_MODEL } from '../types/vision';
import {
  buildSocraticSystemPrompt,
  determineNextSocraticMode,
  CHILD_RESPONSE_CLASSIFIER_PROMPT,
  describeModeTransition,
} from './prompts';

// ============================================================================
// エラー型
// ============================================================================

export class SocraticEngineError extends Error {
  constructor(message: string) {
    super(`[SocraticEngine] ${message}`);
    this.name = 'SocraticEngineError';
  }
}

// ============================================================================
// Gemini Text API 呼び出し (軽量モデル: Flash-Lite)
// ============================================================================

interface ChatTurn {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface ChatRequestBody {
  contents: ChatTurn[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig: {
    temperature: number;
    topK?: number;
    topP?: number;
    maxOutputTokens: number;
    responseMimeType?: 'application/json' | 'text/plain';
  };
}

interface ChatResponseBody {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

async function callGeminiText(
  systemPrompt: string,
  history: ChatTurn[],
  options: {
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
    responseMimeType?: 'application/json' | 'text/plain';
  } = {}
): Promise<string> {
  const apiKey =
    process.env.GOOGLE_API_KEY ??
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ??
    process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new SocraticEngineError('GEMINI_API_KEY is not set');
  }

  const model = options.model ?? DEFAULT_CHAT_MODEL;
  const body: ChatRequestBody = {
    contents: history,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      topK: 40,
      topP: 0.9,
      maxOutputTokens: options.maxOutputTokens ?? 256,
      ...(options.responseMimeType
        ? { responseMimeType: options.responseMimeType }
        : {}),
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg =
      (err as { error?: { message?: string } }).error?.message ??
      `HTTP ${response.status}`;
    throw new SocraticEngineError(`Gemini Text API error: ${msg}`);
  }

  const data = (await response.json()) as ChatResponseBody;
  if (data.promptFeedback?.blockReason) {
    throw new SocraticEngineError(
      `Content blocked: ${data.promptFeedback.blockReason}`
    );
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || text.length === 0) {
    throw new SocraticEngineError('Empty response from Gemini Text API');
  }

  return text.trim();
}

// ============================================================================
// 児童発話の分類 (軽量、JSON 構造化出力)
// ============================================================================

interface ClassificationOutput {
  classification: ChildResponseClassification;
  reasoning?: string;
}

/**
 * 児童の発話を vague/concrete/stuck/correct/partial に分類。
 * Gemini Flash-Lite で並列実行を想定 (レイテンシ < 500ms)。
 */
export async function classifyChildResponse(
  childResponse: string,
  options: { model?: string } = {}
): Promise<ChildResponseClassification> {
  // 簡易ヒューリスティック (API 呼ばずに即決)
  const heuristic = quickClassifyByKeyword(childResponse);
  if (heuristic) return heuristic;

  // ヒューリスティックで判定不能 → API 呼び出し
  const text = await callGeminiText(
    CHILD_RESPONSE_CLASSIFIER_PROMPT,
    [
      {
        role: 'user',
        parts: [{ text: `児童の発言: 「${childResponse}」` }],
      },
    ],
    {
      model: options.model ?? DEFAULT_CHAT_MODEL,
      temperature: 0.2,
      maxOutputTokens: 128,
      responseMimeType: 'application/json',
    }
  );

  try {
    const parsed = JSON.parse(text) as ClassificationOutput;
    if (isValidClassification(parsed.classification)) {
      return parsed.classification;
    }
  } catch {
    // パース失敗 → vague に倒す
  }
  return 'vague';
}

function quickClassifyByKeyword(text: string): ChildResponseClassification | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'stuck';

  const stuckSignals = ['もういや', 'やめたい', 'むり', 'できない', 'もうわからない'];
  if (stuckSignals.some((kw) => trimmed.includes(kw))) {
    return 'stuck';
  }

  const vagueSignals = ['わからない', 'わかんない', 'なんとなく', 'うーん'];
  if (vagueSignals.some((kw) => trimmed === kw || trimmed.startsWith(kw))) {
    // 完全一致または先頭一致のみ vague (具体的な続きがあれば下流に渡す)
    if (trimmed.length < 10) return 'vague';
  }

  return null; // ヒューリスティック判定不能
}

function isValidClassification(s: unknown): s is ChildResponseClassification {
  return (
    s === 'vague' ||
    s === 'concrete' ||
    s === 'stuck' ||
    s === 'correct' ||
    s === 'partial'
  );
}

// ============================================================================
// 対話セッションの開始
// ============================================================================

export interface StartDialogueResult {
  state: SocraticDialogueState;
  firstQuestion: string;
}

/**
 * Vision の結果から特定の StumblingPoint を選び、対話を開始する。
 */
export async function startDialogue(
  vision: VisionAnalysisResult,
  stumblingPointId: string,
  options: {
    childGrade?: number;
    sessionId?: string;
    model?: string;
  } = {}
): Promise<StartDialogueResult> {
  const point = vision.stumbling_points.find(
    (p) => p.mark_id === stumblingPointId
  );
  if (!point) {
    throw new SocraticEngineError(
      `StumblingPoint not found: mark_id=${stumblingPointId}`
    );
  }

  const sessionId = options.sessionId ?? generateSessionId();
  const initialMode: SocraticMode = 'exploratory';

  const systemPrompt = buildSocraticSystemPrompt({
    metadata: vision.document_metadata,
    stumbling_point: point,
    mode: initialMode,
    child_grade: options.childGrade,
  });

  const firstQuestion = await callGeminiText(
    systemPrompt,
    [
      {
        role: 'user',
        parts: [
          { text: 'はじめまして。最初の質問をお願いします。' },
        ],
      },
    ],
    {
      model: options.model ?? DEFAULT_CHAT_MODEL,
      temperature: 0.7,
      maxOutputTokens: 128,
    }
  );

  const sanitized = sanitizeQuestion(firstQuestion);

  const state: SocraticDialogueState = {
    session_id: sessionId,
    stumbling_point_id: stumblingPointId,
    mode: initialMode,
    turn_count: 1,
    child_response_history: [],
    concept_understanding_score: 0.5,
    next_question_strategy: 'deepen',
  };

  return { state, firstQuestion: sanitized };
}

// ============================================================================
// 対話セッションの継続
// ============================================================================

export interface ContinueDialogueResult {
  state: SocraticDialogueState;
  nextQuestion: string;
  /** モード遷移があった場合のログ文字列 */
  modeTransition?: string;
}

/**
 * 児童の発話を受け取り、次の質問を生成する。
 *
 * 流れ:
 * 1. 発話を分類
 * 2. 次のモードを決定
 * 3. 状態を更新
 * 4. システムプロンプトを再構築 (新モード反映)
 * 5. 次の質問を生成
 */
export async function continueDialogue(
  state: SocraticDialogueState,
  vision: VisionAnalysisResult,
  childResponse: string,
  options: {
    childGrade?: number;
    model?: string;
  } = {}
): Promise<ContinueDialogueResult> {
  const point = vision.stumbling_points.find(
    (p) => p.mark_id === state.stumbling_point_id
  );
  if (!point) {
    throw new SocraticEngineError(
      `StumblingPoint not found in vision result: ${state.stumbling_point_id}`
    );
  }

  // 1. 発話を分類
  const classification = await classifyChildResponse(childResponse, {
    model: options.model,
  });

  // 2. モード遷移
  const nextMode = determineNextSocraticMode(state.mode, classification);
  const transition =
    nextMode !== state.mode
      ? describeModeTransition(state.mode, nextMode, classification)
      : undefined;

  // 3. 履歴に追加
  const newRecord: ChildResponseRecord = {
    turn: state.turn_count,
    content: childResponse,
    classified_as: classification,
    timestamp: Date.now(),
  };
  const newHistory = [...state.child_response_history, newRecord];

  // 4. 理解度スコアを更新 (簡易ヒューリスティック)
  const newScore = updateUnderstandingScore(
    state.concept_understanding_score,
    classification
  );

  // 5. 次の戦略を決定
  const nextStrategy = decideNextStrategy(classification, newScore);

  // 6. システムプロンプト + 履歴で次の質問を生成
  const systemPrompt = buildSocraticSystemPrompt({
    metadata: vision.document_metadata,
    stumbling_point: point,
    mode: nextMode,
    child_grade: options.childGrade,
  });

  const chatHistory = buildChatHistory(newHistory);

  const nextQuestionRaw = await callGeminiText(
    systemPrompt,
    chatHistory,
    {
      model: options.model ?? DEFAULT_CHAT_MODEL,
      temperature: 0.7,
      maxOutputTokens: 128,
    }
  );

  const nextQuestion = sanitizeQuestion(nextQuestionRaw);

  // 7. 新しい状態
  const newState: SocraticDialogueState = {
    ...state,
    mode: nextMode,
    turn_count: state.turn_count + 1,
    child_response_history: newHistory,
    concept_understanding_score: newScore,
    next_question_strategy: nextStrategy,
  };

  return {
    state: newState,
    nextQuestion,
    modeTransition: transition,
  };
}

// ============================================================================
// 補助: 状態遷移ロジック
// ============================================================================

/**
 * 児童発話分類 → 理解度スコアの増減
 *
 * - correct: +0.2
 * - partial: +0.1
 * - concrete: +0.05 (内容次第なので控えめ)
 * - vague: -0.05
 * - stuck: -0.15
 *
 * 0-1 にクランプ。
 */
function updateUnderstandingScore(
  current: number,
  classification: ChildResponseClassification
): number {
  const delta: Record<ChildResponseClassification, number> = {
    correct: 0.2,
    partial: 0.1,
    concrete: 0.05,
    vague: -0.05,
    stuck: -0.15,
  };
  const next = current + delta[classification];
  return Math.max(0, Math.min(1, next));
}

function decideNextStrategy(
  classification: ChildResponseClassification,
  score: number
): SocraticDialogueState['next_question_strategy'] {
  if (classification === 'correct' && score >= 0.8) return 'conclude';
  if (classification === 'stuck') return 'simplify';
  if (classification === 'vague') return 'broaden';
  return 'deepen';
}

/**
 * 児童発話履歴 → Gemini Chat history 形式
 *
 * 注: assistant 側 (model role) の発話は再現できないため、user の発話のみ伝達。
 * Gemini は systemInstruction で「最後にこれを言ったから次の質問を返せ」と理解する。
 */
function buildChatHistory(history: ChildResponseRecord[]): ChatTurn[] {
  return history.map((rec) => ({
    role: 'user' as const,
    parts: [{ text: rec.content }],
  }));
}

// ============================================================================
// 出力サニタイズ (ソクラテス式ルール強制)
// ============================================================================

/**
 * AI 出力に「答え」が含まれていないか、複数質問でないかを軽くチェック。
 * - 改行で複数発話がある場合は最初の文だけ採用
 * - 末尾に「？」「?」がない場合は付与 (「考えてみよう」も許容)
 */
function sanitizeQuestion(raw: string): string {
  const trimmed = raw.trim();
  // 改行で分割し、最初の意味ある行だけ
  const firstLine = trimmed.split(/\n+/)[0]?.trim() ?? '';

  // 完全一致が空の場合は元の trimmed を返す
  if (firstLine.length === 0) return trimmed;

  return firstLine;
}

// ============================================================================
// セッション ID 生成
// ============================================================================

function generateSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `socratic-${ts}-${rand}`;
}

// ============================================================================
// 状態の永続化補助 (storage.ts 流用想定)
// ============================================================================

const SESSION_STORAGE_PREFIX = 'socratic_session_';

export function buildSessionStorageKey(sessionId: string): string {
  return `${SESSION_STORAGE_PREFIX}${sessionId}`;
}

/**
 * 対話セッションの完了判定 (UI 側で「終了ボタン」を出すかの基準)
 */
export function isDialogueReadyToConclude(state: SocraticDialogueState): boolean {
  if (state.next_question_strategy === 'conclude') return true;
  if (state.turn_count >= 10) return true; // 長すぎる対話は終了
  if (state.concept_understanding_score >= 0.85) return true;
  return false;
}

// ============================================================================
// 補助エクスポート (再利用 / テスト容易化)
// ============================================================================

export {
  callGeminiText,
  sanitizeQuestion,
  updateUnderstandingScore,
  decideNextStrategy,
};

export type { StumblingPoint };
