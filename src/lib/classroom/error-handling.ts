/**
 * Classroom API エラーハンドリングとリトライ戦略
 *
 * 設計根拠（Research Prompt 3）：
 * - 403 PERMISSION_DENIED: 永続エラー → リトライ無効、即フォールバック
 * - 404 NOT_FOUND: ローカルDB論理削除トリガー
 * - 400 FAILED_PRECONDITION: Drive API 連動修復 or 手動アラート
 * - 429/500/502/503/504: ジッター付き指数バックオフでリトライ
 * - その他 4xx: 永続エラー扱い（コード bug の可能性）
 */

export type ClassroomErrorCategory =
  | 'TRANSIENT'         // 一時的エラー: バックオフリトライ
  | 'PERMISSION_DENIED' // 403: GCP プロジェクト権限境界、リトライ無効
  | 'NOT_FOUND'         // 404: リソース削除済み、ローカル論理削除
  | 'PRECONDITION'      // 400 FAILED_PRECONDITION: 修復ロジック起動
  | 'AUTH_EXPIRED'      // 401: トークンリフレッシュ後リトライ
  | 'PERMANENT'         // それ以外の永続エラー
  | 'UNKNOWN';

export interface ClassroomApiErrorDetails {
  category: ClassroomErrorCategory;
  status: number;
  message: string;
  detail?: string; // "@ProjectPermissionDenied", "AttachmentNotVisible" など
  retryable: boolean;
  resource?: { courseId?: string; courseWorkId?: string; submissionId?: string };
}

export class ClassroomApiError extends Error {
  public readonly details: ClassroomApiErrorDetails;

  constructor(details: ClassroomApiErrorDetails) {
    super(`[${details.category}] ${details.message}${details.detail ? ` (${details.detail})` : ''}`);
    this.name = 'ClassroomApiError';
    this.details = details;
  }
}

/**
 * Google API エラーレスポンスからエラーカテゴリを判定
 */
export function categorizeApiError(
  status: number,
  errorBody: unknown,
  resource?: { courseId?: string; courseWorkId?: string; submissionId?: string }
): ClassroomApiError {
  const body = errorBody as { error?: { message?: string; status?: string; details?: Array<{ reason?: string }> } };
  const message = body.error?.message ?? `HTTP ${status}`;
  const detail = body.error?.details?.[0]?.reason;

  let category: ClassroomErrorCategory = 'UNKNOWN';
  let retryable = false;

  if (status === 401) {
    category = 'AUTH_EXPIRED';
    retryable = true; // トークンリフレッシュ後、1回だけリトライ
  } else if (status === 403) {
    category = 'PERMISSION_DENIED';
    retryable = false;
  } else if (status === 404) {
    category = 'NOT_FOUND';
    retryable = false;
  } else if (status === 400) {
    // FAILED_PRECONDITION の判定
    if (body.error?.status === 'FAILED_PRECONDITION' || detail === 'AttachmentNotVisible') {
      category = 'PRECONDITION';
      retryable = false; // 修復後に再実行（呼び出し側ロジック）
    } else {
      category = 'PERMANENT';
      retryable = false;
    }
  } else if (status === 429 || (status >= 500 && status < 600)) {
    category = 'TRANSIENT';
    retryable = true;
  } else if (status >= 400 && status < 500) {
    category = 'PERMANENT';
    retryable = false;
  }

  return new ClassroomApiError({
    category,
    status,
    message,
    detail,
    retryable,
    resource,
  });
}

// ============================================================================
// ジッター付き指数バックオフ
// ============================================================================

export interface BackoffConfig {
  /** 初回バックオフ ms。デフォルト 1000 */
  baseDelayMs?: number;
  /** 最大遅延 ms。デフォルト 32000 */
  maxDelayMs?: number;
  /** 最大リトライ回数。デフォルト 5 */
  maxAttempts?: number;
  /** ジッター ms（0..jitterMs の乱数を加算）。デフォルト 1000 */
  jitterMs?: number;
}

const DEFAULT_BACKOFF: Required<BackoffConfig> = {
  baseDelayMs: 1000,
  maxDelayMs: 32000,
  maxAttempts: 5,
  jitterMs: 1000,
};

/**
 * 指数バックオフ with ジッターで API コールを再試行する。
 *
 * 数学モデル: WaitTime = min(maxDelay, baseDelay * 2^attempt + random(0, jitter))
 *
 * Thundering Herd 防止のためジッターは必須。
 *
 * @param fn 実行する非同期関数
 * @param config バックオフ設定
 * @param onRetry リトライ時のコールバック（ロギング用）
 */
export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  config: BackoffConfig = {},
  onRetry?: (attempt: number, delay: number, error: unknown) => void
): Promise<T> {
  const cfg = { ...DEFAULT_BACKOFF, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // リトライ不可エラーは即座に throw
      if (err instanceof ClassroomApiError && !err.details.retryable) {
        throw err;
      }

      // 最終試行で失敗したら throw
      if (attempt === cfg.maxAttempts - 1) {
        throw err;
      }

      // 指数バックオフ + ジッター
      const exponential = cfg.baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * cfg.jitterMs;
      const delay = Math.min(cfg.maxDelayMs, exponential + jitter);

      onRetry?.(attempt + 1, delay, err);
      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// エラー別リカバリー戦略のディスパッチャ
// ============================================================================

export interface RecoveryHandlers {
  /** 403 検知時: ローカルに「このリソースはアプリ管理外」フラグ付与 + UI フォールバック */
  onPermissionDenied?: (err: ClassroomApiError) => Promise<void> | void;
  /** 404 検知時: ローカル DB を論理削除 */
  onNotFound?: (err: ClassroomApiError) => Promise<void> | void;
  /** 400 FAILED_PRECONDITION 検知時: Drive 共有設定修復など */
  onPrecondition?: (err: ClassroomApiError) => Promise<void> | void;
  /** 401 検知時: トークンリフレッシュを呼び出し */
  onAuthExpired?: (err: ClassroomApiError) => Promise<void> | void;
}

/**
 * ClassroomApiError をエラーカテゴリに基づき適切なハンドラへディスパッチ。
 * リカバリー処理後も元のエラーを再 throw する（呼び出し側で気付けるように）。
 */
export async function dispatchErrorRecovery(
  err: unknown,
  handlers: RecoveryHandlers
): Promise<never> {
  if (!(err instanceof ClassroomApiError)) {
    throw err;
  }

  switch (err.details.category) {
    case 'PERMISSION_DENIED':
      await handlers.onPermissionDenied?.(err);
      break;
    case 'NOT_FOUND':
      await handlers.onNotFound?.(err);
      break;
    case 'PRECONDITION':
      await handlers.onPrecondition?.(err);
      break;
    case 'AUTH_EXPIRED':
      await handlers.onAuthExpired?.(err);
      break;
  }

  throw err;
}
