/**
 * Google Classroom API のリソースモデル型定義
 *
 * 参考: https://developers.google.com/classroom/reference/rest
 *
 * 設計原則：
 * - Google 側のフィールド名（camelCase）をそのまま採用
 * - readonly フィールドと書き込み可能フィールドを明示分離
 * - draftGrade と assignedGrade は別物として扱う（教員の途中入力 vs 確定）
 */

// ============================================================================
// 認証関連
// ============================================================================

export interface OAuthTokens {
  /** API リクエストの Bearer に使う */
  accessToken: string;
  /** アクセストークン更新用。長期保管必須（KMS 暗号化推奨） */
  refreshToken: string;
  /** Unix epoch ms。これを過ぎたらリフレッシュ必須 */
  expiresAt: number;
  /** 付与されたスコープ（半角スペース区切り） */
  scope: string;
  /** トークン種別。常に "Bearer" */
  tokenType: 'Bearer';
}

export interface OAuthRole {
  /** "teacher" or "student"。turnIn は "student" 必須、CourseWork 作成は "teacher" 必須 */
  role: 'teacher' | 'student';
  /** 紐付くユーザーの内部 ID（学習アプリ側の user_id） */
  userId: string;
}

// ============================================================================
// Course
// ============================================================================

export interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
  descriptionHeading?: string;
  description?: string;
  room?: string;
  ownerId: string;
  creationTime: string; // RFC3339
  updateTime: string;
  enrollmentCode?: string;
  courseState: 'COURSE_STATE_UNSPECIFIED' | 'ACTIVE' | 'ARCHIVED' | 'PROVISIONED' | 'DECLINED' | 'SUSPENDED';
  alternateLink?: string;
  teacherGroupEmail?: string;
  courseGroupEmail?: string;
  guardiansEnabled?: boolean;
}

export interface CourseAlias {
  /**
   * デベロッパープロジェクトスコープ: "d:" プレフィックス
   * ドメインスコープ: "p:" プレフィックス
   */
  alias: string;
}

// ============================================================================
// CourseWork（課題）
// ============================================================================

export type CourseWorkType = 'COURSE_WORK_TYPE_UNSPECIFIED' | 'ASSIGNMENT' | 'SHORT_ANSWER_QUESTION' | 'MULTIPLE_CHOICE_QUESTION';
export type CourseWorkState = 'COURSE_WORK_STATE_UNSPECIFIED' | 'PUBLISHED' | 'DRAFT' | 'DELETED';
export type SubmissionModificationMode = 'MODIFIABLE_UNTIL_TURNED_IN' | 'MODIFIABLE';

export interface ClassroomMaterial {
  driveFile?: { driveFile: { id: string; title?: string; alternateLink?: string }; shareMode?: 'VIEW' | 'EDIT' | 'STUDENT_COPY' };
  youtubeVideo?: { id?: string; title?: string; alternateLink?: string; thumbnailUrl?: string };
  link?: { url: string; title?: string; thumbnailUrl?: string };
  form?: { formUrl: string; responseUrl?: string; title?: string; thumbnailUrl?: string };
}

export interface ClassroomCourseWork {
  courseId?: string;
  id?: string;
  title: string;
  description?: string;
  materials?: ClassroomMaterial[];
  state?: CourseWorkState;
  alternateLink?: string;
  creationTime?: string;
  updateTime?: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours: number; minutes: number; seconds?: number };
  maxPoints?: number;
  workType?: CourseWorkType;
  associatedWithDeveloper?: boolean;
  assigneeMode?: 'ASSIGNEE_MODE_UNSPECIFIED' | 'ALL_STUDENTS' | 'INDIVIDUAL_STUDENTS';
  individualStudentsOptions?: { studentIds: string[] };
  submissionModificationMode?: SubmissionModificationMode;
  creatorUserId?: string;
}

// ============================================================================
// StudentSubmission（提出）
// ============================================================================

export type SubmissionState = 'SUBMISSION_STATE_UNSPECIFIED' | 'NEW' | 'CREATED' | 'TURNED_IN' | 'RETURNED' | 'RECLAIMED_BY_STUDENT';

export interface ClassroomStudentSubmission {
  courseId: string;
  courseWorkId: string;
  id: string;
  userId: string;
  creationTime: string;
  updateTime: string;
  state: SubmissionState;
  late?: boolean;
  /** 教員が「返却（Return）」前に入力する仮成績。学生・親には未公開 */
  draftGrade?: number;
  /** 教員が「返却」後に確定する成績。親向け表示はこちらのみ */
  assignedGrade?: number;
  alternateLink?: string;
  courseWorkType?: CourseWorkType;
  associatedWithDeveloper?: boolean;
  submissionHistory?: SubmissionHistoryItem[];
  assignmentSubmission?: { attachments?: ClassroomMaterial[] };
  shortAnswerSubmission?: { answer: string };
  multipleChoiceSubmission?: { answer: string };
}

export interface SubmissionHistoryItem {
  stateHistory?: {
    state: SubmissionState;
    stateTimestamp: string;
    actorUserId: string;
  };
  gradeHistory?: {
    pointsEarned?: number;
    maxPoints?: number;
    gradeTimestamp: string;
    actorUserId: string;
    gradeChangeType?: 'GRADE_CHANGE_TYPE_UNSPECIFIED' | 'DRAFT_GRADE_POINTS_EARNED_CHANGE' | 'ASSIGNED_GRADE_POINTS_EARNED_CHANGE' | 'MAX_POINTS_CHANGE';
  };
}

// ============================================================================
// Pub/Sub Push 通知
// ============================================================================

export interface ClassroomPubSubMessage {
  message: {
    data: string; // base64 エンコード JSON
    messageId: string;
    publishTime: string;
    attributes?: Record<string, string>;
  };
  subscription: string;
}

/** デコード後の Classroom 通知ペイロード */
export interface ClassroomNotificationPayload {
  collection: 'courses.courseWork.studentSubmissions' | 'courses.courseWork' | 'courses';
  eventType: 'CREATED' | 'UPDATED' | 'DELETED';
  resourceId: {
    courseId: string;
    courseWorkId?: string;
    studentSubmissionId?: string;
  };
}

export interface ClassroomRegistration {
  registrationId: string;
  feed: {
    feedType: 'COURSE_ROSTER_CHANGES' | 'COURSE_WORK_CHANGES';
    courseRosterChangesInfo?: { courseId: string };
    courseWorkChangesInfo?: { courseId: string };
  };
  cloudPubsubTopic: { topicName: string };
  /** 登録は1週間で expire。Cron で再登録必要 */
  expiryTime: string;
}

// ============================================================================
// 学習アプリ内部のマッピング
// ============================================================================

/**
 * 学習アプリの内部「学年×教科×クラス」を Classroom コースエイリアスにマップする。
 *
 * 命名規則: `d:lapp_g{grade}_{subject}_{classCode}`
 * 例: "d:lapp_g3_math_A1"
 */
export interface AppCourseMapping {
  grade: 1 | 2 | 3 | 4 | 5 | 6;
  subject: 'math' | 'japanese' | 'science' | 'social';
  classCode: string;
  alias: string; // 上記命名規則で生成
  classroomCourseId?: string; // 後から populate される
}
