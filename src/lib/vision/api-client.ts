/**
 * Gemini Vision API クライアント
 *
 * 設計原則:
 * - fetch ベース (gemini.ts と統一)
 * - response_mime_type: 'application/json' で構造化出力強制
 * - response_schema: VISION_RESPONSE_SCHEMA で厳密な型保証
 * - temperature: 0.1 で幻覚抑制
 * - ジッター付き指数バックオフ (Vision 用にカスタマイズ)
 *
 * 詳細仕様: skills/vision-api-spec.md (4. プロンプトエンジニアリング仕様)
 */

import type {
  VisionRequest,
  VisionRequestOptions,
  VisionApiResponse,
  VisionAnalysisResult,
} from '../types/vision';
import {
  DEFAULT_VISION_MODEL,
  DEFAULT_TEMPERATURE,
} from '../types/vision';
import { VISION_RESPONSE_SCHEMA, validateVisionResponse } from './json-schema';
import { buildVisionPrompt } from './prompts';

// ============================================================================
// Vision API 専用エラー (classroom/error-handling.ts と独立)
// ============================================================================

export type VisionErrorCategory =
  | 'TRANSIENT'         // 429/5xx: バックオフリトライ
  | 'INVALID_REQUEST'   // 400: リクエスト形式エラー
  | 'AUTH'              // 401/403: API キー不正
  | 'QUOTA_EXCEEDED'    // 429: クォータ枯渇 (バックオフ後リトライ)
  | 'CONTENT_BLOCKED'   // safety フィルタにブロック
  | 'INVALID_RESPONSE'  // JSON パース失敗 / スキーマ違反
  | 'TIMEOUT'           // クライアント側タイムアウト
  | 'NETWORK'           // ネットワークエラー
  | 'UNKNOWN';

export interface VisionApiErrorDetails {
  category: VisionErrorCategory;
  status?: number;
  message: string;
  retryable: boolean;
  /** バリデーションエラーの場合のエラー一覧 */
  validation_errors?: string[];
  /** 元のレスポンス本文（デバッグ用） */
  raw_response?: unknown;
}

export class VisionApiError extends Error {
  public readonly details: VisionApiErrorDetails;

  constructor(details: VisionApiErrorDetails) {
    super(`[Vision/${details.category}] ${details.message}`);
    this.name = 'VisionApiError';
    this.details = details;
  }
}

/**
 * HTTP ステータス + エラー本文から VisionApiError を構築
 */
export function categorizeVisionError(
  status: number,
  errorBody: unknown
): VisionApiError {
  const body = errorBody as {
    error?: {
      message?: string;
      status?: string;
      details?: Array<{ reason?: string }>;
    };
  };
  const message = body.error?.message ?? `HTTP ${status}`;

  let category: VisionErrorCategory = 'UNKNOWN';
  let retryable = false;

  if (status === 400) {
    category = 'INVALID_REQUEST';
    retryable = false;
  } else if (status === 401 || status === 403) {
    category = 'AUTH';
    retryable = false;
  } else if (status === 429) {
    category = 'QUOTA_EXCEEDED';
    retryable = true;
  } else if (status >= 500 && status < 600) {
    category = 'TRANSIENT';
    retryable = true;
  } else if (status >= 400) {
    category = 'INVALID_REQUEST';
    retryable = false;
  }

  return new VisionApiError({
    category,
    status,
    message,
    retryable,
    raw_response: errorBody,
  });
}

// ============================================================================
// Vision API 専用バックオフ (classroom/error-handling のロジックを Vision エラーで動かす)
// ============================================================================

interface VisionBackoffConfig {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  jitterMs?: number;
}

const DEFAULT_BACKOFF: Required<VisionBackoffConfig> = {
  baseDelayMs: 1000,
  maxDelayMs: 16000,
  maxAttempts: 3,
  jitterMs: 500,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withVisionBackoff<T>(
  fn: () => Promise<T>,
  config: VisionBackoffConfig = {},
  onRetry?: (attempt: number, delay: number, error: unknown) => void
): Promise<T> {
  const cfg = { ...DEFAULT_BACKOFF, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Vision エラー以外、または リトライ不可エラーは即 throw
      if (err instanceof VisionApiError && !err.details.retryable) {
        throw err;
      }
      if (attempt === cfg.maxAttempts - 1) {
        throw err;
      }

      const exponential = cfg.baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * cfg.jitterMs;
      const delay = Math.min(cfg.maxDelayMs, exponential + jitter);

      onRetry?.(attempt + 1, delay, err);
      await sleep(delay);
    }
  }

  throw lastError;
}

// ============================================================================
// Gemini API リクエストボディ型
// ============================================================================

interface GeminiVisionRequestBody {
  contents: Array<{
    role: 'user';
    parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    >;
  }>;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
    responseMimeType: 'application/json';
    responseSchema: typeof VISION_RESPONSE_SCHEMA;
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
}

interface GeminiResponseBody {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
    safetyRatings?: Array<{ category: string; probability: string }>;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  promptFeedback?: {
    blockReason?: string;
  };
}

// ============================================================================
// メイン関数: analyzeImage
// ============================================================================

/**
 * Gemini Vision API を呼び出して画像を解析する。
 *
 * @param request   Vision リクエスト (base64 画像 + MIME type + 任意の教科ヒント)
 * @param options   モデル・温度・タイムアウト等のオーバーライド
 * @returns         検証済みの VisionAnalysisResult + メタデータ
 *
 * @throws VisionApiError - 各種カテゴリ (TRANSIENT/INVALID_REQUEST/AUTH/CONTENT_BLOCKED/INVALID_RESPONSE/...)
 *
 * @example
 * const response = await analyzeImage({
 *   image_base64: '...',
 *   mime_type: 'image/jpeg',
 *   subject_hint: '算数',
 * });
 * console.log(response.result.stumbling_points);
 */
export async function analyzeImage(
  request: VisionRequest,
  options: VisionRequestOptions = {}
): Promise<VisionApiResponse> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new VisionApiError({
      category: 'AUTH',
      message: 'GEMINI_API_KEY (or NEXT_PUBLIC_GEMINI_API_KEY) is not set',
      retryable: false,
    });
  }

  const model = options.model ?? DEFAULT_VISION_MODEL;
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE;
  const maxOutputTokens = options.max_output_tokens ?? 4096;
  const timeoutMs = options.timeout_ms ?? 30000;
  const maxRetries = options.max_retries ?? 3;

  // システムプロンプト + 教科ヒント
  const systemPrompt = buildVisionPrompt(request.subject_hint);

  // ユーザーパーツ: 画像 + (任意) 追加コンテキスト
  const userParts: GeminiVisionRequestBody['contents'][0]['parts'] = [
    {
      inlineData: {
        mimeType: request.mime_type,
        data: request.image_base64,
      },
    },
  ];
  if (request.user_context) {
    userParts.push({ text: request.user_context });
  }

  const body: GeminiVisionRequestBody = {
    contents: [
      {
        role: 'user',
        parts: userParts,
      },
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: VISION_RESPONSE_SCHEMA,
    },
    // 教育用途のため safety はやや緩めに（医療系等を除く）
    safetySettings: [
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };

  const startedAt = Date.now();

  // リトライ込みで API コール
  const data = await withVisionBackoff<GeminiResponseBody>(
    () => callGeminiVisionApi(apiKey, model, body, timeoutMs),
    { maxAttempts: maxRetries }
  );

  // レスポンス検証
  const result = parseAndValidateResponse(data);

  const processingTimeMs = Date.now() - startedAt;

  return {
    result,
    model_used: model,
    input_tokens: data.usageMetadata?.promptTokenCount,
    output_tokens: data.usageMetadata?.candidatesTokenCount,
    cache_hit:
      (data.usageMetadata?.cachedContentTokenCount ?? 0) > 0,
    processing_time_ms: processingTimeMs,
  };
}

// ============================================================================
// 内部関数: API コール (タイムアウト + エラーハンドリング)
// ============================================================================

async function callGeminiVisionApi(
  apiKey: string,
  model: string,
  body: GeminiVisionRequestBody,
  timeoutMs: number
): Promise<GeminiResponseBody> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new VisionApiError({
        category: 'TIMEOUT',
        message: `Request timed out after ${timeoutMs}ms`,
        retryable: true,
      });
    }
    throw new VisionApiError({
      category: 'NETWORK',
      message: `Network error: ${(err as Error).message}`,
      retryable: true,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw categorizeVisionError(response.status, errorBody);
  }

  return (await response.json()) as GeminiResponseBody;
}

// ============================================================================
// 内部関数: レスポンスパース + バリデーション
// ============================================================================

function parseAndValidateResponse(data: GeminiResponseBody): VisionAnalysisResult {
  // safety filter による block チェック
  if (data.promptFeedback?.blockReason) {
    throw new VisionApiError({
      category: 'CONTENT_BLOCKED',
      message: `Content blocked by safety filter: ${data.promptFeedback.blockReason}`,
      retryable: false,
      raw_response: data,
    });
  }

  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new VisionApiError({
      category: 'INVALID_RESPONSE',
      message: 'No candidates in Gemini response',
      retryable: false,
      raw_response: data,
    });
  }

  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    if (candidate.finishReason === 'SAFETY') {
      throw new VisionApiError({
        category: 'CONTENT_BLOCKED',
        message: 'Response blocked by safety filter',
        retryable: false,
        raw_response: data,
      });
    }
    if (candidate.finishReason === 'MAX_TOKENS') {
      throw new VisionApiError({
        category: 'INVALID_RESPONSE',
        message: 'Response truncated by max_output_tokens',
        retryable: false,
        raw_response: data,
      });
    }
  }

  const text = candidate.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || text.length === 0) {
    throw new VisionApiError({
      category: 'INVALID_RESPONSE',
      message: 'Empty response text from Gemini',
      retryable: false,
      raw_response: data,
    });
  }

  // JSON 構造化出力のため、text は JSON 文字列の前提
  const validation = validateVisionResponse(text);
  if (!validation.valid || !validation.data) {
    throw new VisionApiError({
      category: 'INVALID_RESPONSE',
      message: 'Vision response failed schema validation',
      retryable: false,
      validation_errors: validation.errors,
      raw_response: text,
    });
  }

  return validation.data;
}

// ============================================================================
// API キー解決 (server / client / Node スクリプト すべて対応)
// ============================================================================

function getApiKey(): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return (
      process.env.GOOGLE_API_KEY ??
      process.env.NEXT_PUBLIC_GEMINI_API_KEY ??
      process.env.GEMINI_API_KEY
    );
  }
  return undefined;
}

// ============================================================================
// 補助エクスポート
// ============================================================================

export { withVisionBackoff };
export type { VisionBackoffConfig };
