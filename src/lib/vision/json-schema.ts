/**
 * Gemini Vision API レスポンス用 JSON スキーマ + バリデータ
 *
 * Gemini API の `response_schema` パラメータに渡す OpenAPI 互換スキーマ。
 * これにより構造化出力が強制され、パースエラーを防ぐ。
 *
 * 詳細仕様: skills/vision-api-spec.md
 */

import type {
  VisionAnalysisResult,
  StumblingPoint,
  NormalizedBoundingBox,
  HandwrittenMarkType,
  SubjectName,
  PageType,
} from '../types/vision';

// ============================================================================
// Gemini API 用 JSON Schema (OpenAPI 互換)
// ============================================================================

/**
 * Gemini API の response_schema として渡すオブジェクト
 *
 * 注意:
 * - Gemini は OpenAPI Schema のサブセットをサポート
 * - 'enum' は string 型のみサポート
 * - 'description' はモデルへのヒントとして機能する (重要)
 */
export const VISION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    document_metadata: {
      type: 'object',
      description: '画像内の文書メタデータ',
      properties: {
        subject: {
          type: 'string',
          enum: ['国語', '算数', '理科', '社会', '英語', '生活', '不明'],
          description: '教科を一つ選択',
        },
        unit_name: {
          type: 'string',
          description: '教科書の上部ヘッダから抽出した単元名',
        },
        grade_estimate: {
          type: 'integer',
          description: '問題の難易度から推定した学年 (1-6)、不明な場合は 0',
        },
        page_type: {
          type: 'string',
          enum: ['textbook', 'workbook', 'notebook', 'test', 'unknown'],
          description: 'ページの種類',
        },
      },
      required: ['subject', 'unit_name'],
    },
    stumbling_points: {
      type: 'array',
      description: '児童が手書きでマークしたつまずき箇所のリスト (マークがなければ空配列)',
      items: {
        type: 'object',
        properties: {
          mark_id: {
            type: 'string',
            description: '一意ID (例: mark-001, mark-002)',
          },
          mark_type: {
            type: 'string',
            enum: ['circle', 'underline', 'question_mark', 'cross', 'triangle', 'tick'],
            description: '手書き記号の種類',
          },
          box_2d: {
            type: 'array',
            description: '正規化座標 [ymin, xmin, ymax, xmax] (各値 0-1000)',
            items: { type: 'integer' },
          },
          extracted_problem: {
            type: 'string',
            description: 'マークが囲んでいる問題文・数式・単語のテキスト',
          },
          identified_concept: {
            type: 'string',
            description: '教育概念 (例: 分数の割り算、光の屈折)',
          },
          cognitive_issue: {
            type: 'string',
            description: '認知的に何が問題か (例: 分母分子の意味理解不足)',
          },
          confidence: {
            type: 'number',
            description: 'AI 認識信頼度 (0-1)',
          },
        },
        required: [
          'mark_id',
          'mark_type',
          'box_2d',
          'extracted_problem',
          'identified_concept',
          'cognitive_issue',
        ],
      },
    },
    image_quality: {
      type: 'object',
      description: '画像品質の評価',
      properties: {
        is_educational_content: {
          type: 'boolean',
          description: '学習教材か (false なら拒否)',
        },
        is_readable: {
          type: 'boolean',
          description: '文字が読み取れるか',
        },
        warnings: {
          type: 'array',
          items: { type: 'string' },
          description: '警告メッセージ',
        },
      },
      required: ['is_educational_content', 'is_readable'],
    },
  },
  required: ['document_metadata', 'stumbling_points', 'image_quality'],
} as const;

// ============================================================================
// Validator (型ガードと正規化)
// ============================================================================

/** バリデーション結果 */
export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  errors: string[];
}

/** 教科名のホワイトリスト */
const SUBJECT_NAMES: SubjectName[] = [
  '国語', '算数', '理科', '社会', '英語', '生活', '不明',
];

/** 手書き記号のホワイトリスト */
const MARK_TYPES: HandwrittenMarkType[] = [
  'circle', 'underline', 'question_mark', 'cross', 'triangle', 'tick',
];

/** ページタイプのホワイトリスト */
const PAGE_TYPES: PageType[] = [
  'textbook', 'workbook', 'notebook', 'test', 'unknown',
];

/**
 * 正規化座標 [ymin, xmin, ymax, xmax] をバリデーション
 */
export function validateBoundingBox(
  box: unknown,
  errors: string[],
  context: string
): box is NormalizedBoundingBox {
  if (!Array.isArray(box) || box.length !== 4) {
    errors.push(`${context}: box_2d must be an array of 4 integers`);
    return false;
  }

  for (let i = 0; i < 4; i++) {
    if (typeof box[i] !== 'number' || !Number.isInteger(box[i])) {
      errors.push(`${context}: box_2d[${i}] must be an integer`);
      return false;
    }
    if (box[i] < 0 || box[i] > 1000) {
      errors.push(`${context}: box_2d[${i}]=${box[i]} out of range [0, 1000]`);
      return false;
    }
  }

  const [ymin, xmin, ymax, xmax] = box as number[];
  if (ymin >= ymax) {
    errors.push(`${context}: ymin (${ymin}) must be less than ymax (${ymax})`);
    return false;
  }
  if (xmin >= xmax) {
    errors.push(`${context}: xmin (${xmin}) must be less than xmax (${xmax})`);
    return false;
  }

  return true;
}

/**
 * 1 つの StumblingPoint をバリデーション
 */
export function validateStumblingPoint(
  point: unknown,
  errors: string[],
  index: number
): point is StumblingPoint {
  if (typeof point !== 'object' || point === null) {
    errors.push(`stumbling_points[${index}]: must be an object`);
    return false;
  }

  const p = point as Record<string, unknown>;

  if (typeof p.mark_id !== 'string' || p.mark_id.length === 0) {
    errors.push(`stumbling_points[${index}]: mark_id must be a non-empty string`);
    return false;
  }

  if (
    typeof p.mark_type !== 'string' ||
    !MARK_TYPES.includes(p.mark_type as HandwrittenMarkType)
  ) {
    errors.push(
      `stumbling_points[${index}]: mark_type must be one of ${MARK_TYPES.join(', ')}`
    );
    return false;
  }

  if (!validateBoundingBox(p.box_2d, errors, `stumbling_points[${index}]`)) {
    return false;
  }

  if (typeof p.extracted_problem !== 'string') {
    errors.push(`stumbling_points[${index}]: extracted_problem must be a string`);
    return false;
  }

  if (typeof p.identified_concept !== 'string') {
    errors.push(`stumbling_points[${index}]: identified_concept must be a string`);
    return false;
  }

  if (typeof p.cognitive_issue !== 'string') {
    errors.push(`stumbling_points[${index}]: cognitive_issue must be a string`);
    return false;
  }

  if (p.confidence !== undefined) {
    if (typeof p.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) {
      errors.push(
        `stumbling_points[${index}]: confidence must be a number in [0, 1]`
      );
      return false;
    }
  }

  return true;
}

/**
 * Vision API の生レスポンス (JSON 文字列または object) をパース・検証する
 *
 * @param raw  Gemini API から返ってきた JSON 文字列または既にパース済みの object
 * @returns    バリデーション結果。valid=true の場合 data に正規化済みデータが入る
 */
export function validateVisionResponse(
  raw: string | unknown
): ValidationResult<VisionAnalysisResult> {
  const errors: string[] = [];

  // 1. JSON パース (文字列の場合)
  let parsed: unknown;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      errors.push(`JSON parse error: ${(e as Error).message}`);
      return { valid: false, errors };
    }
  } else {
    parsed = raw;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    errors.push('Response must be a JSON object');
    return { valid: false, errors };
  }

  const obj = parsed as Record<string, unknown>;

  // 2. document_metadata
  if (typeof obj.document_metadata !== 'object' || obj.document_metadata === null) {
    errors.push('document_metadata is required and must be an object');
    return { valid: false, errors };
  }
  const meta = obj.document_metadata as Record<string, unknown>;
  if (
    typeof meta.subject !== 'string' ||
    !SUBJECT_NAMES.includes(meta.subject as SubjectName)
  ) {
    errors.push(
      `document_metadata.subject must be one of ${SUBJECT_NAMES.join(', ')}`
    );
    return { valid: false, errors };
  }
  if (typeof meta.unit_name !== 'string') {
    errors.push('document_metadata.unit_name must be a string');
    return { valid: false, errors };
  }
  if (
    meta.page_type !== undefined &&
    (typeof meta.page_type !== 'string' ||
      !PAGE_TYPES.includes(meta.page_type as PageType))
  ) {
    errors.push(
      `document_metadata.page_type must be one of ${PAGE_TYPES.join(', ')}`
    );
    return { valid: false, errors };
  }

  // 3. stumbling_points (空配列も許容)
  if (!Array.isArray(obj.stumbling_points)) {
    errors.push('stumbling_points must be an array');
    return { valid: false, errors };
  }
  for (let i = 0; i < obj.stumbling_points.length; i++) {
    if (!validateStumblingPoint(obj.stumbling_points[i], errors, i)) {
      return { valid: false, errors };
    }
  }

  // 4. image_quality
  if (typeof obj.image_quality !== 'object' || obj.image_quality === null) {
    errors.push('image_quality is required and must be an object');
    return { valid: false, errors };
  }
  const quality = obj.image_quality as Record<string, unknown>;
  if (typeof quality.is_educational_content !== 'boolean') {
    errors.push('image_quality.is_educational_content must be a boolean');
    return { valid: false, errors };
  }
  if (typeof quality.is_readable !== 'boolean') {
    errors.push('image_quality.is_readable must be a boolean');
    return { valid: false, errors };
  }
  if (
    quality.warnings !== undefined &&
    (!Array.isArray(quality.warnings) ||
      quality.warnings.some((w) => typeof w !== 'string'))
  ) {
    errors.push('image_quality.warnings must be an array of strings');
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: obj as unknown as VisionAnalysisResult,
    errors: [],
  };
}

// ============================================================================
// 補助: 正規化座標の追加検証 (面積・順序)
// ============================================================================

/**
 * バウンディングボックスが「意味のあるサイズ」かを判定
 * - 面積が画像の 0.5% 未満: 誤検知の可能性大
 * - 面積が画像の 80% 以上: 画像全体を指していて意味なし
 */
export function isMeaningfulBoundingBox(box: NormalizedBoundingBox): boolean {
  const [ymin, xmin, ymax, xmax] = box;
  const areaRatio = ((ymax - ymin) * (xmax - xmin)) / (1000 * 1000);
  return areaRatio >= 0.005 && areaRatio < 0.8;
}

/**
 * StumblingPoint のリストを「意味のあるもの」だけにフィルタ
 */
export function filterMeaningfulStumblingPoints(
  points: StumblingPoint[]
): StumblingPoint[] {
  return points.filter((p) => isMeaningfulBoundingBox(p.box_2d));
}
