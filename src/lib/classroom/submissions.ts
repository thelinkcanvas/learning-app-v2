/**
 * 提出ライフサイクル：modifyAttachments → turnIn の連続処理
 *
 * 設計根拠（Research Prompt 3）：
 * - 学生のセッション完了 → レポート URL を Link として添付 → 自動提出
 * - turnIn は学生コンテキスト必須 + 同一 GCP プロジェクト作成必須
 * - 403 PermissionDenied 時は手動提出フォールバックを UI に表示
 * - 404 時はローカル DB を論理削除
 */

import type { ClassroomMaterial, ClassroomStudentSubmission } from '../types/classroom';
import { ClassroomApiClient, ClassroomApiError, type AuthContext } from './api-client';

export interface AttachAndTurnInInput {
  /** 学生の認証コンテキスト（turnIn は学生トークン必須） */
  studentAuth: AuthContext;
  /** 対象コース。エイリアス文字列でも OK */
  courseId: string;
  courseWorkId: string;
  submissionId: string;
  /** 学習アプリのレポート URL（Link オブジェクトとして添付される） */
  reportUrl: string;
  /** 表示タイトル */
  reportTitle?: string;
}

export interface AttachAndTurnInResult {
  status: 'success' | 'permission_denied' | 'not_found' | 'precondition_failed' | 'error';
  finalSubmission?: ClassroomStudentSubmission;
  /** UI フォールバックメッセージ（403/404 時に使う） */
  userMessage?: string;
  error?: ClassroomApiError;
}

/**
 * セッション完了時の標準フロー：
 * 1. レポート URL を Link として添付
 * 2. 提出を TURNED_IN に遷移
 *
 * エラーは throw せず、status コードで返す（UI 側で状態に応じて表示制御するため）
 */
export async function attachAndTurnIn(
  client: ClassroomApiClient,
  input: AttachAndTurnInInput
): Promise<AttachAndTurnInResult> {
  const link: ClassroomMaterial = {
    link: {
      url: input.reportUrl,
      title: input.reportTitle ?? '学習完了レポート',
    },
  };

  // ステップ1: 添付
  try {
    await client.modifyAttachments(
      input.studentAuth,
      input.courseId,
      input.courseWorkId,
      input.submissionId,
      [link]
    );
  } catch (err) {
    return mapError(err, '添付');
  }

  // ステップ2: 自動提出
  try {
    const finalSubmission = await client.turnIn(
      input.studentAuth,
      input.courseId,
      input.courseWorkId,
      input.submissionId
    );
    return { status: 'success', finalSubmission };
  } catch (err) {
    return mapError(err, '提出');
  }
}

function mapError(err: unknown, phase: string): AttachAndTurnInResult {
  if (!(err instanceof ClassroomApiError)) {
    return {
      status: 'error',
      userMessage: `${phase}処理で予期せぬエラーが発生しました`,
      error: undefined,
    };
  }

  switch (err.details.category) {
    case 'PERMISSION_DENIED':
      return {
        status: 'permission_denied',
        userMessage:
          'この課題はアプリの管理外で作成されたため、自動提出できません。' +
          'Google Classroom の画面から直接「提出」を押してください。',
        error: err,
      };
    case 'NOT_FOUND':
      return {
        status: 'not_found',
        userMessage:
          '対象の課題が見つかりませんでした。教員によって削除された可能性があります。',
        error: err,
      };
    case 'PRECONDITION':
      return {
        status: 'precondition_failed',
        userMessage:
          phase === '添付'
            ? '添付ファイルへのアクセス権限が不足しています。教員に共有設定を確認してください。'
            : `${phase}処理の前提条件が満たされていません。`,
        error: err,
      };
    default:
      return {
        status: 'error',
        userMessage: `${phase}処理でエラーが発生しました（${err.details.message}）`,
        error: err,
      };
  }
}

// ============================================================================
// 採点取得（draftGrade vs assignedGrade）
// ============================================================================

export interface GradeSnapshot {
  /** 教員入力中の仮成績（学生・親には未公開） */
  draftGrade?: number;
  /** 確定成績（親向け表示はこちらのみ） */
  assignedGrade?: number;
  /** 表示用ステータス */
  status: 'graded' | 'in_progress' | 'not_started';
  /** 親向けに表示してよい値 */
  publicScore?: number;
}

/**
 * Submission から「親に見せてよい採点情報」を抽出。
 *
 * Research Prompt 3 より:
 * - draftGrade は教員の途中入力 → 「採点中」とマスク表示
 * - assignedGrade のみ確定値として親に見せる
 */
export function extractParentVisibleGrade(
  submission: ClassroomStudentSubmission
): GradeSnapshot {
  if (submission.assignedGrade !== undefined) {
    return {
      assignedGrade: submission.assignedGrade,
      status: 'graded',
      publicScore: submission.assignedGrade,
    };
  }
  if (submission.draftGrade !== undefined) {
    return {
      draftGrade: submission.draftGrade, // バックエンド内部のみ。親には渡さない
      status: 'in_progress',
      publicScore: undefined,
    };
  }
  return { status: 'not_started' };
}
