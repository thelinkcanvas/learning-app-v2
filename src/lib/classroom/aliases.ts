/**
 * 学習アプリの「学年×教科×クラス」と Classroom コースの疎結合マッピング
 *
 * 設計根拠（Research Prompt 3）：
 * - DB 対応表方式は同期ズレ・状態管理コストが高い
 * - エイリアス機能を使えば、API 呼び出し時に直接マッピング可能
 * - "d:" プレフィックス = デベロッパープロジェクトスコープ（他アプリと衝突しない）
 *
 * 命名規則: `d:lapp_g{grade}_{subject}_{classCode}`
 * 例: "d:lapp_g3_math_A1"
 */

import type { Subject, Grade } from '../prompt-templates';
import type { AppCourseMapping } from '../types/classroom';

const ALIAS_PREFIX = 'd:lapp_';

export interface MappingInput {
  grade: Grade;
  subject: Subject;
  classCode: string;
}

/**
 * AppCourseMapping のエイリアス文字列を生成。
 *
 * classCode の例: "A1", "ueno-ele-3a", "horikatu-home" など、
 * クラス編成の意味的識別子を半角英数字で渡す。
 */
export function buildCourseAlias(input: MappingInput): string {
  const safeClass = input.classCode.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return `${ALIAS_PREFIX}g${input.grade}_${input.subject}_${safeClass}`;
}

/**
 * エイリアス文字列を逆解析して内部マッピング情報を抽出。
 * 形式不正の場合は null を返す。
 */
export function parseCourseAlias(alias: string): MappingInput | null {
  if (!alias.startsWith(ALIAS_PREFIX)) return null;
  const body = alias.slice(ALIAS_PREFIX.length);
  const m = body.match(/^g(\d)_([a-z]+)_(.+)$/);
  if (!m) return null;

  const grade = parseInt(m[1], 10);
  if (grade < 1 || grade > 6) return null;

  const subject = m[2];
  if (!['math', 'japanese', 'science', 'social'].includes(subject)) return null;

  return {
    grade: grade as Grade,
    subject: subject as Subject,
    classCode: m[3],
  };
}

/**
 * AppCourseMapping を完全構築する（classroomCourseId は後から populate）
 */
export function createMapping(input: MappingInput): AppCourseMapping {
  return {
    grade: input.grade,
    subject: input.subject,
    classCode: input.classCode,
    alias: buildCourseAlias(input),
  };
}

/**
 * 4 教科 × 6 学年 = 24 個のマッピングを一括生成。
 * 同じ classCode で全教科のクラスを統一する場合に便利。
 */
export function generateAllMappings(classCode: string): AppCourseMapping[] {
  const grades: Grade[] = [1, 2, 3, 4, 5, 6];
  const subjects: Subject[] = ['math', 'japanese', 'science', 'social'];
  const out: AppCourseMapping[] = [];
  for (const grade of grades) {
    for (const subject of subjects) {
      out.push(createMapping({ grade, subject, classCode }));
    }
  }
  return out;
}
