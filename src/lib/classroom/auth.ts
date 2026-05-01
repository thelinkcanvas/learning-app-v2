/**
 * Google OAuth 2.0 認証フロー（Classroom API 用）
 *
 * 設計根拠（Research Prompt 3）：
 * - 3-legged OAuth + リフレッシュトークン永続化
 * - turnIn は学生コンテキスト必須、CourseWork 作成は教員コンテキスト必須
 * - アクセストークンは1時間で expire → 自動リフレッシュ機構が必須
 * - リフレッシュトークン保管は KMS 等での暗号化が前提（本実装は平文 JSON ファイル）
 *
 * 既存の src/lib/gemini.ts と同じ fetch ベースで統一。SDK は使わない。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { OAuthTokens, OAuthRole } from '../types/classroom';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Classroom API で必要となるスコープ一覧。
 *
 * 最小権限の原則: ロールに応じて使い分ける。
 */
export const CLASSROOM_SCOPES = {
  // コース閲覧（教員・学生どちらも）
  COURSES_READONLY: 'https://www.googleapis.com/auth/classroom.courses.readonly',
  // コース管理（教員のみ）
  COURSES: 'https://www.googleapis.com/auth/classroom.courses',
  // 課題の読み書き（教員）
  COURSEWORK_TEACHERS: 'https://www.googleapis.com/auth/classroom.coursework.students',
  // 自分の課題（学生）
  COURSEWORK_ME: 'https://www.googleapis.com/auth/classroom.coursework.me',
  // 課題に成果物を添付
  ME_READONLY: 'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  // 名簿（教員）
  ROSTERS: 'https://www.googleapis.com/auth/classroom.rosters',
  // Push 通知登録
  PUSH_NOTIFICATIONS: 'https://www.googleapis.com/auth/classroom.push-notifications',
} as const;

export const SCOPES_BY_ROLE: Record<'teacher' | 'student', string[]> = {
  teacher: [
    CLASSROOM_SCOPES.COURSES,
    CLASSROOM_SCOPES.COURSEWORK_TEACHERS,
    CLASSROOM_SCOPES.ROSTERS,
    CLASSROOM_SCOPES.PUSH_NOTIFICATIONS,
  ],
  student: [
    CLASSROOM_SCOPES.COURSES_READONLY,
    CLASSROOM_SCOPES.COURSEWORK_ME,
  ],
};

// ============================================================================
// 認可 URL 生成（ステップ1：ユーザーを Google にリダイレクト）
// ============================================================================

export interface AuthUrlOptions {
  clientId: string;
  redirectUri: string;
  /** "teacher" or "student" でスコープが切り替わる */
  role: 'teacher' | 'student';
  /** CSRF 対策用のランダムな state 値。コールバックで検証必須 */
  state: string;
  /** "consent" を指定するとリフレッシュトークンが確実に返る */
  prompt?: 'consent' | 'select_account';
  /** 追加スコープ（必要に応じて） */
  extraScopes?: string[];
}

export function buildAuthorizationUrl(opts: AuthUrlOptions): string {
  const scopes = [...SCOPES_BY_ROLE[opts.role], ...(opts.extraScopes ?? [])];

  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline', // リフレッシュトークン取得に必須
    include_granted_scopes: 'true',
    state: opts.state,
    prompt: opts.prompt ?? 'consent',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ============================================================================
// 認可コード → トークン交換（ステップ2：コールバックで実行）
// ============================================================================

export interface ExchangeOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: 'Bearer';
}

export async function exchangeCodeForTokens(opts: ExchangeOptions): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${errBody}`);
  }

  const data = (await res.json()) as GoogleTokenResponse;
  if (!data.refresh_token) {
    throw new Error('リフレッシュトークンが返却されませんでした。prompt=consent を確認してください');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    tokenType: 'Bearer',
  };
}

// ============================================================================
// アクセストークン自動リフレッシュ
// ============================================================================

export interface RefreshOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * リフレッシュトークンを使って新しいアクセストークンを取得。
 * 残り有効時間が 5 分未満ならリフレッシュ推奨。
 */
export async function refreshAccessToken(opts: RefreshOptions): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${errBody}`);
  }

  const data = (await res.json()) as GoogleTokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: opts.refreshToken, // リフレッシュ時は元のものを保持
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    tokenType: 'Bearer',
  };
}

/**
 * トークンの有効期限を確認し、残り 5 分未満なら自動リフレッシュ。
 */
export async function ensureFreshToken(
  tokens: OAuthTokens,
  clientId: string,
  clientSecret: string
): Promise<OAuthTokens> {
  const fiveMinutesMs = 5 * 60 * 1000;
  if (tokens.expiresAt - Date.now() > fiveMinutesMs) {
    return tokens;
  }
  return refreshAccessToken({
    clientId,
    clientSecret,
    refreshToken: tokens.refreshToken,
  });
}

// ============================================================================
// トークン永続化（簡易ファイルストア。本番は KMS + DB 推奨）
// ============================================================================

export interface TokenStore {
  load(userId: string): Promise<{ tokens: OAuthTokens; role: OAuthRole } | null>;
  save(userId: string, role: OAuthRole, tokens: OAuthTokens): Promise<void>;
  delete(userId: string): Promise<void>;
}

/**
 * 開発用：JSON ファイルベースのトークンストア。
 * 本番は必ず KMS 暗号化 + DB に置き換えること。
 */
export class JsonFileTokenStore implements TokenStore {
  constructor(private readonly storeDir: string) {}

  private filePath(userId: string): string {
    const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.storeDir, `${safe}.json`);
  }

  async load(userId: string): Promise<{ tokens: OAuthTokens; role: OAuthRole } | null> {
    try {
      const buf = await fs.promises.readFile(this.filePath(userId), 'utf-8');
      return JSON.parse(buf);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(userId: string, role: OAuthRole, tokens: OAuthTokens): Promise<void> {
    await fs.promises.mkdir(this.storeDir, { recursive: true });
    await fs.promises.writeFile(
      this.filePath(userId),
      JSON.stringify({ tokens, role }, null, 2),
      'utf-8'
    );
  }

  async delete(userId: string): Promise<void> {
    try {
      await fs.promises.unlink(this.filePath(userId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
