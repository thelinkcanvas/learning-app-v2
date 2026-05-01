/**
 * Classroom REST API クライアント（fetch 直叩き、googleapis SDK 不使用）
 *
 * 設計根拠：
 * - 既存 src/lib/gemini.ts と同じスタイルで一貫性確保
 * - 全エンドポイントを withExponentialBackoff でラップ → クォータ枯渇耐性
 * - 401 トークン期限切れは自動リフレッシュ後にリトライ
 * - エラーは ClassroomApiError に正規化されて throw
 */

import type {
  OAuthTokens,
  ClassroomCourse,
  CourseAlias,
  ClassroomCourseWork,
  ClassroomStudentSubmission,
  ClassroomMaterial,
  ClassroomRegistration,
  SubmissionState,
} from '../types/classroom';
import {
  categorizeApiError,
  withExponentialBackoff,
  ClassroomApiError,
  type BackoffConfig,
} from './error-handling';
import { ensureFreshToken } from './auth';

const CLASSROOM_BASE_URL = 'https://classroom.googleapis.com/v1';

export interface ClientConfig {
  clientId: string;
  clientSecret: string;
  /** バックオフ設定（オプション） */
  backoff?: BackoffConfig;
  /** デバッグログ出力 */
  verbose?: boolean;
}

export interface AuthContext {
  tokens: OAuthTokens;
  /** トークンを永続化したい場合のコールバック（リフレッシュ後に呼ばれる） */
  onTokenRefresh?: (newTokens: OAuthTokens) => Promise<void>;
}

export class ClassroomApiClient {
  constructor(private readonly config: ClientConfig) {}

  // ==========================================================================
  // 内部：認証付き fetch ラッパー
  // ==========================================================================

  private async authenticatedFetch<T>(
    auth: AuthContext,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    resource?: { courseId?: string; courseWorkId?: string; submissionId?: string }
  ): Promise<T> {
    return withExponentialBackoff(
      async () => {
        // 1. トークン期限チェック + 自動リフレッシュ
        const fresh = await ensureFreshToken(
          auth.tokens,
          this.config.clientId,
          this.config.clientSecret
        );
        if (fresh.accessToken !== auth.tokens.accessToken) {
          auth.tokens = fresh;
          await auth.onTokenRefresh?.(fresh);
        }

        // 2. 実 API コール
        const url = `${CLASSROOM_BASE_URL}${path}`;
        const headers: Record<string, string> = {
          Authorization: `Bearer ${fresh.accessToken}`,
        };
        if (body !== undefined) headers['Content-Type'] = 'application/json';

        if (this.config.verbose) {
          console.log(`[Classroom API] ${method} ${path}`);
        }

        const res = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        // 3. エラー判定
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw categorizeApiError(res.status, errBody, resource);
        }

        // 4. 204 No Content 対応
        if (res.status === 204) return undefined as T;

        return (await res.json()) as T;
      },
      this.config.backoff,
      (attempt, delay, err) => {
        if (this.config.verbose) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Classroom API] Retry ${attempt} after ${delay.toFixed(0)}ms: ${msg}`);
        }
      }
    );
  }

  // ==========================================================================
  // Courses
  // ==========================================================================

  async listCourses(auth: AuthContext, params: { teacherId?: string; studentId?: string; pageSize?: number } = {}): Promise<{ courses?: ClassroomCourse[]; nextPageToken?: string }> {
    const qs = new URLSearchParams();
    if (params.teacherId) qs.set('teacherId', params.teacherId);
    if (params.studentId) qs.set('studentId', params.studentId);
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    return this.authenticatedFetch(auth, 'GET', `/courses?${qs.toString()}`);
  }

  async getCourse(auth: AuthContext, courseId: string): Promise<ClassroomCourse> {
    return this.authenticatedFetch(auth, 'GET', `/courses/${encodeURIComponent(courseId)}`, undefined, { courseId });
  }

  async createCourse(auth: AuthContext, course: Partial<ClassroomCourse>): Promise<ClassroomCourse> {
    return this.authenticatedFetch(auth, 'POST', `/courses`, course);
  }

  // ==========================================================================
  // Aliases (デベロッパープロジェクトスコープ "d:" を使う)
  // ==========================================================================

  async createAlias(auth: AuthContext, courseId: string, alias: CourseAlias): Promise<CourseAlias> {
    return this.authenticatedFetch(
      auth,
      'POST',
      `/courses/${encodeURIComponent(courseId)}/aliases`,
      alias,
      { courseId }
    );
  }

  async listAliases(auth: AuthContext, courseId: string): Promise<{ aliases?: CourseAlias[] }> {
    return this.authenticatedFetch(auth, 'GET', `/courses/${encodeURIComponent(courseId)}/aliases`, undefined, { courseId });
  }

  // ==========================================================================
  // CourseWork
  // ==========================================================================

  async createCourseWork(
    auth: AuthContext,
    courseId: string,
    courseWork: ClassroomCourseWork
  ): Promise<ClassroomCourseWork> {
    return this.authenticatedFetch(
      auth,
      'POST',
      `/courses/${encodeURIComponent(courseId)}/courseWork`,
      courseWork,
      { courseId }
    );
  }

  async listCourseWork(auth: AuthContext, courseId: string): Promise<{ courseWork?: ClassroomCourseWork[] }> {
    return this.authenticatedFetch(auth, 'GET', `/courses/${encodeURIComponent(courseId)}/courseWork`, undefined, { courseId });
  }

  // ==========================================================================
  // StudentSubmission
  // ==========================================================================

  async listSubmissions(
    auth: AuthContext,
    courseId: string,
    courseWorkId: string,
    params: { userId?: string; states?: SubmissionState[] } = {}
  ): Promise<{ studentSubmissions?: ClassroomStudentSubmission[] }> {
    const qs = new URLSearchParams();
    if (params.userId) qs.set('userId', params.userId);
    if (params.states) params.states.forEach(s => qs.append('states', s));
    return this.authenticatedFetch(
      auth,
      'GET',
      `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions?${qs.toString()}`,
      undefined,
      { courseId, courseWorkId }
    );
  }

  async getSubmission(
    auth: AuthContext,
    courseId: string,
    courseWorkId: string,
    submissionId: string
  ): Promise<ClassroomStudentSubmission> {
    return this.authenticatedFetch(
      auth,
      'GET',
      `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}`,
      undefined,
      { courseId, courseWorkId, submissionId }
    );
  }

  async modifyAttachments(
    auth: AuthContext,
    courseId: string,
    courseWorkId: string,
    submissionId: string,
    addAttachments: ClassroomMaterial[]
  ): Promise<ClassroomStudentSubmission> {
    return this.authenticatedFetch(
      auth,
      'POST',
      `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}:modifyAttachments`,
      { addAttachments },
      { courseId, courseWorkId, submissionId }
    );
  }

  /**
   * 提出を完了状態（TURNED_IN）に遷移させる。
   *
   * 重要：
   * - 学生の OAuth トークンで呼ぶ必要がある
   * - リクエストボディは空オブジェクト {} 必須（API 仕様）
   * - 当該 CourseWork が同じ GCP プロジェクトで作成されたものでないと 403 になる
   */
  async turnIn(
    auth: AuthContext,
    courseId: string,
    courseWorkId: string,
    submissionId: string
  ): Promise<ClassroomStudentSubmission> {
    return this.authenticatedFetch(
      auth,
      'POST',
      `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}:turnIn`,
      {}, // 空オブジェクト必須
      { courseId, courseWorkId, submissionId }
    );
  }

  /**
   * 教員側からの成績更新。
   * draftGrade と assignedGrade のどちらか/両方を変更可能。
   */
  async patchSubmission(
    auth: AuthContext,
    courseId: string,
    courseWorkId: string,
    submissionId: string,
    patch: { draftGrade?: number; assignedGrade?: number },
    updateMask: Array<'draftGrade' | 'assignedGrade'>
  ): Promise<ClassroomStudentSubmission> {
    const qs = new URLSearchParams({ updateMask: updateMask.join(',') });
    return this.authenticatedFetch(
      auth,
      'PATCH',
      `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}?${qs.toString()}`,
      patch,
      { courseId, courseWorkId, submissionId }
    );
  }

  // ==========================================================================
  // Push Notification Registrations
  // ==========================================================================

  async createRegistration(
    auth: AuthContext,
    feedType: 'COURSE_WORK_CHANGES' | 'COURSE_ROSTER_CHANGES',
    courseId: string,
    pubsubTopicName: string
  ): Promise<ClassroomRegistration> {
    const feed: Record<string, unknown> = { feedType };
    if (feedType === 'COURSE_WORK_CHANGES') {
      feed.courseWorkChangesInfo = { courseId };
    } else {
      feed.courseRosterChangesInfo = { courseId };
    }
    return this.authenticatedFetch(auth, 'POST', `/registrations`, {
      feed,
      cloudPubsubTopic: { topicName: pubsubTopicName },
    });
  }

  async deleteRegistration(auth: AuthContext, registrationId: string): Promise<void> {
    await this.authenticatedFetch(auth, 'DELETE', `/registrations/${encodeURIComponent(registrationId)}`);
  }
}

// ============================================================================
// 便利な再 export
// ============================================================================

export { ClassroomApiError } from './error-handling';
