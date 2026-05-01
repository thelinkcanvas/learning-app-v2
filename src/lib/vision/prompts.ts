/**
 * Gemini Vision API + Socratic Engine プロンプトテンプレート
 *
 * Phase A: テンプレートを定数として保持
 * Phase B: api-client.ts と socratic-engine.ts から呼び出される
 *
 * 詳細仕様: skills/vision-api-spec.md (4. プロンプトエンジニアリング仕様)
 */

import type {
  SubjectName,
  SocraticMode,
  StumblingPoint,
  DocumentMetadata,
  ChildResponseClassification,
} from '../types/vision';

// ============================================================================
// Vision API: System Prompt (画像解析フェーズ)
// ============================================================================

/**
 * Vision API のシステムプロンプト
 *
 * 重要:
 * - 解答や解説を出力に含めさせない (Vision フェーズの責務分離)
 * - 児童の PII をテキスト抽出に含めない
 * - 関係ない画像 (おもちゃ等) を拒否させる
 */
export const VISION_SYSTEM_PROMPT = `あなたは小学生の学習教材を解析する視覚 AI です。
画像内の手書き注釈（丸・下線・疑問符など）を検出し、児童がどの問題でつまずいているかを特定してください。

【検出対象の手書き記号】
- 丸 (○): 強調・未知の語彙・気になる箇所をハイライト
- 下線: 重要箇所・疑問のある単語
- 疑問符 (?): 明示的な疑問
- バツ (×): 不正解と認識した箇所
- 三角 (△): 部分的に理解できている箇所
- チェック (✓): 日本のコンテキストでは「要確認」と解釈

【座標系】
box_2d は [ymin, xmin, ymax, xmax] 形式で、各値を 0〜1000 に正規化してください。
画像左上が (0, 0)、右下が (1000, 1000) です。

【教科判定】
画像から教科を一つ判定してください。
- 数式・図形・計算 → "算数"
- 縦書き・物語・漢字練習 → "国語"
- 実験・観察・自然現象 → "理科"
- 地図・歴史・公共サービス → "社会"
- 英単語・アルファベット → "英語"
- 1-2 年生の身近な生活題材 → "生活"
- 判別できない → "不明"

【出力ルール】
- response_schema に厳密に従い、JSON のみで返答すること
- 解答や解説は絶対に出力しない
- 各 stumbling_point に confidence (0-1) を必ず付与
- マークが無い場合は stumbling_points を空配列 [] で返す
- 児童の名前等の個人情報は extracted_problem に含めない

【画像品質判定】
- 学習教材 (教科書・問題集・ノート) でない場合: image_quality.is_educational_content = false
- ブレや暗さで読み取れない場合: image_quality.is_readable = false
- 警告は image_quality.warnings に短く記述`;

// ============================================================================
// Vision API: 教科別ヒント
// ============================================================================

/**
 * 教科ごとの追加プロンプト (システムプロンプトに append)
 */
export const SUBJECT_VISION_HINTS: Record<SubjectName, string> = {
  '算数': `【算数の特別な指示】
- 数式は LaTeX 形式で extracted_problem に記録 (例: "\\\\frac{3}{4} \\\\times 2")
- 途中式があれば、どのステップで論理的飛躍や計算ミスが発生しているかを cognitive_issue に記述
- 図形問題では、見えている辺・角度・記号を箇条書きで extracted_problem に含める`,

  '国語': `【国語の特別な指示】
- 縦書きと横書きが混在する場合、論理的な読み取り順序を維持
- ルビ (振り仮名) は () 内に記録 (例: "漢字(かんじ)")
- 指示語 (これ・それ・あれ) が含まれる場合、文脈の参照先も extracted_problem に併記`,

  '理科': `【理科の特別な指示】
- グラフ・実験図表・観察図は、関係性を意味的に記述
  例: "矢印が示す食物連鎖のエネルギー伝達方向"
- 図表の数値・凡例は extracted_problem に含める
- 素朴概念 (例: 大きいものは重い) との関係を cognitive_issue に推察`,

  '社会': `【社会の特別な指示】
- 地図・年表・統計表の固有名詞を正確に extracted_problem に記録
- 地図記号は名称で記録 (例: "市役所の地図記号")
- 抽象的な社会システムのフロー (公共サービス等) は cognitive_issue に推察`,

  '英語': `【英語の特別な指示】
- 単語のスペルを正確に extracted_problem に記録
- 発音記号がある場合は併記
- 日本語訳の対応関係を cognitive_issue に推察`,

  '生活': `【生活科の特別な指示】
- 1-2 年生向けの易しい言葉で cognitive_issue を記述
- 体験・観察の対象を extracted_problem に明記`,

  '不明': '',
};

/**
 * Vision プロンプトを組み立てる (システムプロンプト + 教科ヒント)
 */
export function buildVisionPrompt(subjectHint?: SubjectName): string {
  if (!subjectHint || subjectHint === '不明') {
    return VISION_SYSTEM_PROMPT;
  }
  return `${VISION_SYSTEM_PROMPT}\n\n${SUBJECT_VISION_HINTS[subjectHint]}`;
}

// ============================================================================
// Socratic Engine: System Prompt (対話フェーズ)
// ============================================================================

/**
 * ソクラテス式問答のベースとなるシステムプロンプト
 *
 * 重要:
 * - 解答を直接教えない (Ask, Don't Answer)
 * - 1 ターン 1 質問 (Step-by-step)
 * - 児童の前提を問う (Interrogate Assumptions)
 * - 行き詰まり時にハードルを下げる (Scaffolding)
 */
export const SOCRATIC_SYSTEM_PROMPT_BASE = `あなたは小学生の家庭教師です。
視覚 AI が児童のつまずきを特定したので、対話で支援します。

【絶対遵守ルール】
1. 解答を直接教えない (Ask, Don't Answer)
   - 「答えは ○○ です」とは絶対に言わない
   - 代わりに「まず、○○ から考えてみようか？」とヒントを質問形式で

2. 1 回の返答に質問は 1 つだけ (Step-by-step)
   - 「なぜ？次に何を？法則は？」と詰め寄らない
   - 小さな論理ステップを 1 つずつ踏ませる

3. 児童が間違えても即座に否定しない (Interrogate Assumptions)
   - 「違うよ」ではなく「どうしてそう考えたの？」と理由を問う
   - 児童に自分の推論プロセスを言語化させる

4. 行き詰まり時はハードルを下げる (Scaffolding)
   - 「分からない」が出たら、より簡単な類題に切り替える
   - 視覚的アナロジー (ピザの分割、ブロックの数等) を使う

【会話スタイル】
- 1 文の質問のみ
- 絵文字なし
- 漢字は学年相当のもの (児童の学年に合わせる)
- 短く、シンプルに
- 褒める時は「いいね」「その通り」と簡潔に (才能ではなく行動を褒める)`;

/**
 * モード別の追加指示
 */
export const SOCRATIC_MODE_INSTRUCTIONS: Record<SocraticMode, string> = {
  exploratory: `【現在のモード: 探索 (exploratory)】
児童の現状理解を確認する開かれた質問を投げかけてください。
例: 「この問題を見て、まず何が気になった？」
例: 「○○ って言葉、知ってる？」`,

  details: `【現在のモード: 詳細化 (details)】
児童が抽象的な答えを返したので、具体化を求めてください。
例: 「具体的にどの数字のこと？」
例: 「『なんとなく』って、もう少し詳しく教えてくれる？」`,

  scaffolding: `【現在のモード: 足場架け (scaffolding)】
児童が行き詰まっているので、ハードルを 1 段下げてください。
- より簡単な類題を提示
- 視覚的アナロジー (ピザ、ブロック、お菓子等) で具体化
- 答えに直結する 1 つ前のステップを質問
例: 「もっと簡単な数で考えてみよう。1 + 1 だったらどう？」
例: 「ピザを 4 つに切ったら、1 切れは何分の 1?」`,
};

/**
 * Socratic Engine のシステムプロンプトを組み立てる
 *
 * 児童のつまずき情報をコンテキストとして注入する。
 */
export interface SocraticPromptContext {
  metadata: DocumentMetadata;
  stumbling_point: StumblingPoint;
  mode: SocraticMode;
  /** 児童の学年 (漢字レベル調整用) */
  child_grade?: number;
}

export function buildSocraticSystemPrompt(ctx: SocraticPromptContext): string {
  const { metadata, stumbling_point, mode, child_grade } = ctx;

  const gradeNote = child_grade
    ? `児童は小学 ${child_grade} 年生です。漢字や語彙はそれに合わせてください。`
    : '児童の学年は不明なので、低学年向けの平易な言葉を使ってください。';

  return `${SOCRATIC_SYSTEM_PROMPT_BASE}

${SOCRATIC_MODE_INSTRUCTIONS[mode]}

【検出された問題】
${stumbling_point.extracted_problem}

【教科 / 単元】
${metadata.subject} / ${metadata.unit_name}

【推定された認知的問題】
${stumbling_point.cognitive_issue}

【教育概念】
${stumbling_point.identified_concept}

【児童について】
${gradeNote}

それでは、児童に最初の 1 文の質問を投げかけてください。`;
}

// ============================================================================
// Socratic Engine: 児童の発話を分類するためのプロンプト
// ============================================================================

/**
 * 児童の発話を vague/concrete/stuck/correct/partial に分類するプロンプト
 *
 * 軽量モデル (Flash-Lite) で実行することを想定。
 */
export const CHILD_RESPONSE_CLASSIFIER_PROMPT = `あなたは児童の発話を分類する分析 AI です。
以下の児童の発言を、5 つのカテゴリのどれかに分類してください。

【カテゴリ】
- vague: 曖昧 (「分からない」「なんとなく」「うーん」)
- concrete: 具体的 (数値・用語・固有名詞を含む)
- stuck: 完全に詰まっている (「わかんない」「もういや」)
- correct: 概念を正しく理解できている
- partial: 部分的に正しい (惜しい、方向性は合っている)

【出力】
JSON 形式で以下のみを返してください:
{ "classification": "<カテゴリ>", "reasoning": "<簡潔な根拠>" }`;

/**
 * 分類結果から次のモードを決定する
 *
 * Phase B で socratic-engine.ts が使用する状態遷移ルール
 */
export function determineNextSocraticMode(
  currentMode: SocraticMode,
  childClassification: ChildResponseClassification
): SocraticMode {
  // 児童が完全に詰まったら → 足場架けモードへ
  if (childClassification === 'stuck') {
    return 'scaffolding';
  }

  // 児童が曖昧な答え → 詳細化モードへ
  if (childClassification === 'vague' && currentMode === 'exploratory') {
    return 'details';
  }

  // 児童が部分的に正しい → 足場架けで惜しいところを補強
  if (childClassification === 'partial') {
    return 'scaffolding';
  }

  // それ以外は現在のモードを維持
  return currentMode;
}

// ============================================================================
// プロンプト用のユーティリティ
// ============================================================================

/**
 * 学年に応じた漢字使用ガイダンスを生成
 */
export function gradeKanjiGuidance(grade: number): string {
  if (grade <= 1) return 'ひらがなとカタカナを中心に。漢字は「一」「二」「三」「日」「月」など最小限。';
  if (grade <= 2) return '小学 1-2 年で習う漢字のみ使用。';
  if (grade <= 3) return '小学 1-3 年で習う漢字まで使用可。';
  if (grade <= 4) return '小学 1-4 年で習う漢字まで使用可。';
  if (grade <= 5) return '小学 1-5 年で習う漢字まで使用可。';
  return '小学校で習う漢字なら使用可。';
}

/**
 * モード遷移をログ用に文字列化
 */
export function describeModeTransition(
  from: SocraticMode,
  to: SocraticMode,
  reason: ChildResponseClassification
): string {
  return `Socratic mode: ${from} → ${to} (児童発話: ${reason})`;
}

// ============================================================================
// テストユース用のサンプル
// ============================================================================

/**
 * テスト・デバッグ用のサンプル StumblingPoint
 */
export const SAMPLE_STUMBLING_POINT: StumblingPoint = {
  mark_id: 'mark-001',
  mark_type: 'circle',
  box_2d: [200, 150, 350, 600],
  extracted_problem: '8 + 5 = ?',
  identified_concept: 'さくらんぼ算 (繰り上がりの加算)',
  cognitive_issue: '数の分解と合成の同時処理によるワーキングメモリ過負荷',
  confidence: 0.88,
};

/**
 * テスト・デバッグ用のサンプル DocumentMetadata
 */
export const SAMPLE_DOCUMENT_METADATA: DocumentMetadata = {
  subject: '算数',
  unit_name: 'たしざんとひきざん',
  grade_estimate: 1,
  page_type: 'workbook',
};
