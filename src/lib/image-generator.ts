/**
 * Gemini Image API ラッパー（REST 直叩き）
 *
 * 既存の src/lib/gemini.ts と同じ fetch ベースのスタイルで統一。
 * SDK は導入しない（依存追加リスク回避）。
 *
 * 機能：
 * - Nano Banana 2 (gemini-3.1-flash-image-preview) 呼び出し
 * - ジッター付き指数的バックオフ
 * - 3 層モデルフォールバック（Nano Banana 2 → 2.5 Flash Image → ベーステンプレ）
 * - safety filter 検知時の専用ハンドリング
 */

const PRIMARY_MODEL = 'gemini-3.1-flash-image-preview';
const FALLBACK_MODEL = 'gemini-2.5-flash-image';

/** リトライ可能な HTTP ステータス */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export interface GenerateImageOptions {
  /** プロンプト本文 */
  prompt: string;
  /** "high" にするとグリッドや空間関係の精度が上がる（コスト・レイテンシ増） */
  thinkingLevel?: 'none' | 'low' | 'medium' | 'high';
  /** "1K" or "2K"。テンプレ用途は 2K 推奨（オーバーサンプリング） */
  imageSize?: '512px' | '1K' | '2K' | '4K';
  /** 1280x800 に最も近いサポート比 */
  aspectRatio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  /** リトライ最大回数 */
  maxRetries?: number;
  /** 初回バックオフ ms */
  initialBackoffMs?: number;
}

export interface GeneratedImage {
  /** 生成画像の Buffer（Base64 デコード済み） */
  buffer: Buffer;
  /** 実際に使われたモデル名 */
  modelUsed: string;
  /** 元の MIME type（"image/jpeg" 等） */
  mimeType: string;
}

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly safetyBlocked = false
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

/**
 * 画像を生成する。複数モデルへのフォールバックを内包。
 */
export async function generateTemplateImage(
  opts: GenerateImageOptions
): Promise<GeneratedImage> {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ImageGenerationError('GEMINI_API_KEY が設定されていません');
  }

  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let lastError: unknown;

  for (const model of models) {
    try {
      return await callWithRetry(model, opts, apiKey);
    } catch (err) {
      lastError = err;
      // safety block は再試行・モデル変更しても結果同じなので即時終了
      if (err instanceof ImageGenerationError && err.safetyBlocked) {
        throw err;
      }
      // 次のフォールバックモデルへ
    }
  }

  throw new ImageGenerationError(
    'すべての画像生成モデルが失敗しました',
    lastError
  );
}

/**
 * 単一モデルに対し、ジッター付き指数バックオフで再試行する。
 */
async function callWithRetry(
  model: string,
  opts: GenerateImageOptions,
  apiKey: string
): Promise<GeneratedImage> {
  const {
    maxRetries = 3,
    initialBackoffMs = 2000,
  } = opts;

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      return await callOnce(model, opts, apiKey);
    } catch (err) {
      lastError = err;

      const status = (err as { status?: number }).status;
      const isRetryable = status !== undefined && RETRY_STATUS.has(status);

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      // 指数 + ジッター
      const base = initialBackoffMs * Math.pow(2, attempt);
      const jitter = Math.random() * 1000;
      await sleep(base + jitter);
      attempt++;
    }
  }

  throw lastError ?? new ImageGenerationError('Unknown retry failure');
}

interface GeminiRestError {
  error?: { code?: number; message?: string; status?: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

async function callOnce(
  model: string,
  opts: GenerateImageOptions,
  apiKey: string
): Promise<GeneratedImage> {
  const {
    prompt,
    thinkingLevel = 'high',
    imageSize = '2K',
    aspectRatio = '16:9',
  } = opts;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      thinkingConfig: { thinkingLevel },
      imageConfig: { aspectRatio, imageSize },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as GeminiRestError;
    const message = errBody.error?.message ?? `HTTP ${res.status}`;
    const e = new ImageGenerationError(`[${model}] ${message}`);
    (e as unknown as { status: number }).status = res.status;
    throw e;
  }

  const data = (await res.json()) as GeminiResponse;

  // safety block の判定
  const blockReason = data.promptFeedback?.blockReason;
  const finishReason = data.candidates?.[0]?.finishReason;
  if (blockReason || finishReason === 'SAFETY') {
    throw new ImageGenerationError(
      `[${model}] safety filter によりブロックされました: ${blockReason ?? finishReason}`,
      undefined,
      true
    );
  }

  // 画像データ抽出
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find(p => p.inlineData?.data);
  if (!imagePart || !imagePart.inlineData?.data) {
    throw new ImageGenerationError(`[${model}] レスポンスに画像データなし`);
  }

  const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
  return {
    buffer,
    modelUsed: model,
    mimeType: imagePart.inlineData.mimeType ?? 'image/jpeg',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
