/**
 * Google Pub/Sub Push 通知の受信・処理
 *
 * 設計根拠（Research Prompt 3）：
 * - Classroom 採点変更は数分以内に Pub/Sub トピックへ push される
 * - ペイロードには ID のみが含まれる（個人情報・スコアは別途 GET 必要）
 * - 1 メッセージ ≒ 2KB、月 1M メッセージで ~2GB → 無料枠内（10GiB/月）
 * - 登録は 1 週間で expire → Cron で再登録必須
 */

import type {
  ClassroomPubSubMessage,
  ClassroomNotificationPayload,
  ClassroomStudentSubmission,
} from '../types/classroom';
import { ClassroomApiClient, type AuthContext } from './api-client';
import { extractParentVisibleGrade, type GradeSnapshot } from './submissions';

/**
 * Pub/Sub Push メッセージから Classroom 通知ペイロードをデコード。
 *
 * data フィールドは base64 エンコードされた JSON 文字列。
 */
export function decodePubSubMessage(msg: ClassroomPubSubMessage): ClassroomNotificationPayload {
  const decoded = Buffer.from(msg.message.data, 'base64').toString('utf-8');
  const payload = JSON.parse(decoded);

  // Classroom の実際のペイロードは collection と eventType を attributes 経由で渡してくる場合あり
  // ここは attributes 優先、body fallback の順で正規化
  const attrs = msg.message.attributes ?? {};
  return {
    collection: (attrs.collection ?? payload.collection) as ClassroomNotificationPayload['collection'],
    eventType: (attrs.eventType ?? payload.eventType) as ClassroomNotificationPayload['eventType'],
    resourceId: payload.resourceId ?? {
      courseId: attrs.courseId,
      courseWorkId: attrs.courseWorkId,
      studentSubmissionId: attrs.studentSubmissionId,
    },
  };
}

// ============================================================================
// 採点逆方向同期：採点イベント → ローカル DB 更新
// ============================================================================

export interface GradeSyncResult {
  payload: ClassroomNotificationPayload;
  /** 採点が変わったか（assignedGrade の更新を検知） */
  gradeChanged: boolean;
  snapshot?: GradeSnapshot;
  /** ローカル DB 更新が必要かどうかの判断材料 */
  shouldNotifyParent: boolean;
}

export interface ParentNotifier {
  /** 親向けダッシュボードへの更新通知 */
  notify(input: { courseId: string; submissionId: string; snapshot: GradeSnapshot }): Promise<void>;
}

export interface LocalGradeStore {
  /** 既存の保存値を取得（新旧比較で変化検出） */
  getLastKnown(submissionId: string): Promise<GradeSnapshot | null>;
  /** 最新スナップショットを保存 */
  save(submissionId: string, snapshot: GradeSnapshot): Promise<void>;
}

/**
 * Pub/Sub 通知受信ハンドラのコア処理。
 *
 * 1. 通知ペイロードをデコード
 * 2. リソース ID を使って最新の Submission を GET（教員トークン経由）
 * 3. extractParentVisibleGrade で親向け表示スコアを抽出
 * 4. ローカル保存値と比較し、変更があれば親へ通知
 */
export async function handleClassroomNotification(
  msg: ClassroomPubSubMessage,
  deps: {
    client: ClassroomApiClient;
    teacherAuth: AuthContext;
    store: LocalGradeStore;
    notifier?: ParentNotifier;
  }
): Promise<GradeSyncResult> {
  const payload = decodePubSubMessage(msg);

  // 採点関連は studentSubmission の更新のみを扱う
  if (
    payload.collection !== 'courses.courseWork.studentSubmissions' ||
    payload.eventType !== 'UPDATED' ||
    !payload.resourceId.studentSubmissionId
  ) {
    return { payload, gradeChanged: false, shouldNotifyParent: false };
  }

  const { courseId, courseWorkId, studentSubmissionId } = payload.resourceId;
  if (!courseId || !courseWorkId) {
    return { payload, gradeChanged: false, shouldNotifyParent: false };
  }

  // 最新 submission 取得（教員コンテキスト推奨：成績情報の閲覧範囲が広い）
  let submission: ClassroomStudentSubmission;
  try {
    submission = await deps.client.getSubmission(
      deps.teacherAuth,
      courseId,
      courseWorkId,
      studentSubmissionId
    );
  } catch (err) {
    // 404 はリソース削除済み、403 は権限問題。どちらも親への通知はしない
    return { payload, gradeChanged: false, shouldNotifyParent: false };
  }

  const snapshot = extractParentVisibleGrade(submission);
  const lastKnown = await deps.store.getLastKnown(studentSubmissionId);

  // assignedGrade の変更のみが「採点完了→親通知」のトリガー
  const gradeChanged =
    lastKnown?.publicScore !== snapshot.publicScore && snapshot.status === 'graded';

  await deps.store.save(studentSubmissionId, snapshot);

  if (gradeChanged && deps.notifier) {
    await deps.notifier.notify({
      courseId,
      submissionId: studentSubmissionId,
      snapshot,
    });
  }

  return { payload, gradeChanged, snapshot, shouldNotifyParent: gradeChanged };
}

// ============================================================================
// 登録ライフサイクル：1週間で expire するので Cron 再登録
// ============================================================================

export interface RegistrationRecord {
  registrationId: string;
  courseId: string;
  expiresAt: number; // Unix epoch ms
  pubsubTopicName: string;
}

/**
 * 失効間近（24時間以内）の登録を検出。
 * Cron からこの結果を使って再登録ループを回す。
 */
export function findExpiringRegistrations(
  registrations: RegistrationRecord[],
  bufferMs = 24 * 60 * 60 * 1000
): RegistrationRecord[] {
  const threshold = Date.now() + bufferMs;
  return registrations.filter(r => r.expiresAt < threshold);
}
