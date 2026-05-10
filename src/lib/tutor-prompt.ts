// 質問深度の自動調整ロジック（家庭教師プロンプトの動的ガイダンス）
// 2026-05-03 追加: 子どもの実機テストで「3+5」のような簡単問題で深掘りされる/「めんどう」で疲労する問題への対処
// 既存の createSystemPrompt(subject) と組み合わせて使う。本ファイルは subject 非依存の信号抽出 + ガイダンス文字列生成のみ。

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PromptContext {
  conversationHistory: PromptMessage[];
  latestUserMessage: string;
}

export type DifficultyLevel = 'simple' | 'standard' | 'complex';
export type AnswerQuality = 'short' | 'descriptive';

export interface AdaptiveSignals {
  difficulty: DifficultyLevel;
  fatigueDetected: boolean;
  answerQuality: AnswerQuality;
  consecutiveShortAnswers: number;
}

// --- 検出パターン ---

// 疲労・離脱シグナル: 子どもが「もう深掘りしたくない」サインを出した時の語句
const FATIGUE_KEYWORDS = [
  'もういい',
  'もうええ',
  '次の問題',
  'つぎの問題',
  'べつの',
  '別の',
  'べつのにしよう',
  'ほかの',
  '他の',
  'めんどう',
  'めんどくさい',
  'やめる',
  'やめたい',
  'スキップ',
  'すきっぷ',
  'パス',
  'ぱす',
  'もうやめる',
  'わからん',
  'わかんない',
  'もういらん',
  'しつこい',
  'くどい',
];

// 簡単な計算問題（1〜2桁の四則）を検出する正規表現
// 例: "3+5", "8-2", "2×3=", "6÷2=?"
const SIMPLE_ARITHMETIC_REGEX = /(?<![\d.])[0-9]{1,2}\s*[+\-＋－×÷*/]\s*[0-9]{1,2}\s*[=＝]?(?!\d)/;

// 文章題・複雑な問題を示すキーワード
const COMPLEX_PROBLEM_KEYWORDS = [
  '人います',
  '人いる',
  '個あり',
  '円の',
  '円を',
  '何個',
  '何人',
  '何枚',
  '何時間',
  '何分',
  '何メートル',
  '面積',
  '周囲',
  '体積',
  'グラフ',
  '表から',
  '比べ',
  '残り',
  '合わせ',
  '全部で',
  '分数',
  '小数',
  '割合',
  '速さ',
  '道のり',
  '時間と',
];

const SHORT_ANSWER_MAX_LEN = 6;
const SHORT_ANSWER_KEYWORDS = ['うん', 'そう', 'はい', 'いいえ', 'うーん', 'なるほど', 'わかった', 'おk', 'ok'];

// --- 検出関数 ---

export function detectDifficulty(context: PromptContext): DifficultyLevel {
  const lastAssistant = [...context.conversationHistory]
    .reverse()
    .find(m => m.role === 'assistant');

  const corpus = lastAssistant?.content ?? '';

  if (COMPLEX_PROBLEM_KEYWORDS.some(k => corpus.includes(k))) {
    return 'complex';
  }

  if (SIMPLE_ARITHMETIC_REGEX.test(corpus)) {
    if (corpus.length < 80) return 'simple';
  }

  return 'standard';
}

export function detectFatigue(latestUserMessage: string): boolean {
  const normalized = latestUserMessage.trim().toLowerCase();
  return FATIGUE_KEYWORDS.some(k => normalized.includes(k.toLowerCase()));
}

export function detectAnswerQuality(latestUserMessage: string): AnswerQuality {
  const trimmed = latestUserMessage.trim();
  if (trimmed.length <= SHORT_ANSWER_MAX_LEN) return 'short';
  if (SHORT_ANSWER_KEYWORDS.some(k => trimmed === k)) return 'short';
  return 'descriptive';
}

export function countConsecutiveShortAnswers(history: PromptMessage[]): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== 'user') continue;
    if (detectAnswerQuality(msg.content) === 'short') {
      count++;
    } else {
      break;
    }
  }
  return count;
}

export function extractSignals(context: PromptContext): AdaptiveSignals {
  const fullHistory: PromptMessage[] = [
    ...context.conversationHistory,
    { role: 'user', content: context.latestUserMessage },
  ];
  return {
    difficulty: detectDifficulty(context),
    fatigueDetected: detectFatigue(context.latestUserMessage),
    answerQuality: detectAnswerQuality(context.latestUserMessage),
    consecutiveShortAnswers: countConsecutiveShortAnswers(fullHistory),
  };
}

// --- ガイダンス文字列 ---
// 既存の createSystemPrompt(subject) の方針（絵文字なし・簡潔）を尊重し、追記する形で動作する。

const DIFFICULTY_GUIDANCE: Record<DifficultyLevel, string> = {
  simple: `
【今回の問題は「簡単」と判定】
- 1桁の足し算・引き算など基礎計算。正解したら短い称賛 → 即座に次の問題へ
- 「どう考えた？」「なぜ？」の深掘りは禁止。テンポを優先する
- 称賛は1文のみ。長い説明・追加質問は不要
- 例：「3+5=8」と正答 → 「正解。じゃあ次は7+4は？」のように繋ぐ
`.trim(),

  standard: `
【今回の問題は「標準」と判定】
- 正答時は短い称賛 + 1段階だけ理由を聞く（例：「正解。どうやって考えた？」）
- 子どもが答えたら次の問題へ。2段階以上の深掘りは控える
`.trim(),

  complex: `
【今回の問題は「複雑（文章題・図形）」と判定】
- 正答時は称賛 + 1〜2段階の理由問いで思考プロセスを言語化させる
- ただし子どもが疲れたサインを出したら即座に切り上げる
- 「式の意味」「なぜその数字を選んだか」「他のやり方もある？」のような問いが有効
`.trim(),
};

const FATIGUE_GUIDANCE = `
【⚠️ 疲労シグナル検知】
- 子どもが「もういい」「次の問題」「べつのにしよう」「めんどう」等のサインを出した
- これ以上の深掘り・追加質問は禁止
- 短く称賛 → 即座に次の問題（または別ジャンル）を提案する
- 例：「OK、じゃあ次の問題いこう。」と切り替える
`.trim();

const SHORT_ANSWER_GUIDANCE = `
【単語回答の連続検知】
- 子どもが「うん」「そう」など短い返事を2回以上連続している
- 深掘り質問が機能していない可能性が高い。質問パターンを変えるか、次の問題へ進む
- 「どう考えた？」を繰り返さず、別の角度（具体例の提示・選択肢提示）に切り替える
`.trim();

const TONE_GUIDANCE = `
【トーン調整】
- 「いいね」「その通り」を機械的に連発しない。直前と同じ称賛を使ったら別の表現を選ぶ
- 簡潔さを保ったまま、表現を変える（例：「正解」「あってる」「うん、それでいい」）
`.trim();

/**
 * 質問深度の自動調整ガイダンスを生成する。
 * createSystemPrompt(subject) が返す基本プロンプトの末尾に append して使う。
 * context が空（初回ターン）の場合は空文字列を返し、基本プロンプトのまま使われる。
 */
export function buildAdaptiveGuidance(context: PromptContext): string {
  // 初回ターン（履歴なし、ユーザーメッセージも空 or 挨拶）はガイダンス不要
  if (context.conversationHistory.length === 0 && !context.latestUserMessage.trim()) {
    return '';
  }

  const signals = extractSignals(context);
  const sections: string[] = [];

  sections.push('---\n## 質問深度の自動調整（このターンの動的ガイダンス）');
  sections.push(DIFFICULTY_GUIDANCE[signals.difficulty]);

  if (signals.fatigueDetected) {
    sections.push(FATIGUE_GUIDANCE);
  }

  if (signals.consecutiveShortAnswers >= 2) {
    sections.push(SHORT_ANSWER_GUIDANCE);
  }

  sections.push(TONE_GUIDANCE);

  return '\n\n' + sections.join('\n\n');
}
