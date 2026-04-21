/**
 * Gemini API 分析層 V2
 *
 * PatternAnalyzer（heuristic）の結果を Gemini で意味的に補強・検証し、
 * 個別化ガイダンス・親向けレポートを生成する。
 *
 * 2層構造:
 * - callGeminiAnalysis() : 低レベル Gemini 呼び出し（JSON 出力）
 * - analyzeDailyWithGemini() : 日次分析（PatternAnalyzer と統合）
 * - analyzeWeeklyWithGemini() : 週間分析（7日分を集約）
 */

import {
  TimestampedMessage,
  DailyAnalysisResult,
  WeeklyReportData,
  ParentGuidanceContent,
  AnalysisPattern,
} from './types/analysis';
import { PatternAnalyzer } from './pattern-analyzer';

// ============================================================================
// Gemini API Types
// ============================================================================

interface GeminiAnalysisRequestBody {
  contents: {
    role: 'user' | 'model';
    parts: { text: string }[];
  }[];
  systemInstruction?: {
    parts: { text: string }[];
  };
  generationConfig: {
    temperature: number;
    topK?: number;
    topP?: number;
    maxOutputTokens: number;
    responseMimeType: 'application/json' | 'text/plain';
    responseSchema?: object;
  };
}

// ============================================================================
// Prompts
// ============================================================================

/**
 * 日次分析システムプロンプト
 * PatternAnalyzer の heuristic 結果を意味的に検証し、個別化ガイダンスを生成
 */
const DAILY_ANALYSIS_SYSTEM_PROMPT = `
あなたは小学校教育の学習分析エキスパートです。
1日分の会話ログ（子どもとAI家庭教師のやり取り）と、既に検出された heuristic パターンを基に、
意味論的な観点から分析を補強し、個別化された学習ガイダンスを生成してください。

【6種類のパターン】
- repetition: 同一質問の繰り返し（定着度不足）
- failure-success: 失敗→成功の遷移（習得プロセス）
- mastery: 教科別得意・苦手分野
- confidence-decline: 確信度低下（集中力低下）
- hint-dependency: ヒント要求頻度（学習スタイル）
- fluency: 学習流暢性（概念理解の進み具合）

【出力ルール】
1. JSON 形式で返す（プレーンテキスト・Markdown 禁止）
2. 推奨アクションは具体的・実行可能なものにする（例：「視覚教材を使う」ではなく「タングラムで形を作る遊びを5分」）
3. 過剰な診断は避ける。データ不足なら「データ不足」と正直に記載
4. 小学生向けの前向きな表現を使う（「苦手」ではなく「これから伸びる分野」など）
`;

/**
 * 週間分析システムプロンプト
 */
const WEEKLY_ANALYSIS_SYSTEM_PROMPT = `
あなたは小学校教育の学習分析エキスパートです。
1週間分の日次分析結果を基に、成長トレンドを評価し、親向けの実行可能なガイダンスを生成してください。

【親向けガイダンスの原則】
1. **具体的な行動**：「数の概念を深める」ではなく「ブロックで10を作る遊びを週3回、各10分」
2. **時間コミット明示**：所要時間を分単位で記載
3. **成果予測**：習得予想日を現実的に示す（楽観的すぎない）
4. **具体的リソース**：書籍名・YouTube動画名・教材名まで具体的に

【出力ルール】
1. JSON 形式で返す
2. 親が週末に実行できる提案を3つ以上含める
3. 褒めるべき成長点を必ず1つ以上含める（親の肯定的フィードバック促進）
`;

// ============================================================================
// Response Schemas (structured JSON output)
// ============================================================================

const DAILY_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    overallAssessment: { type: 'string' },
    enhancedPatterns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          confidence: { type: 'number' },
          semanticRefinement: { type: 'string' },
          concreteAction: { type: 'string' },
        },
        required: ['type', 'confidence', 'semanticRefinement', 'concreteAction'],
      },
    },
    childGuidance: {
      type: 'object',
      properties: {
        tone: { type: 'string' },
        nextStepSuggestion: { type: 'string' },
        encouragement: { type: 'string' },
      },
      required: ['tone', 'nextStepSuggestion', 'encouragement'],
    },
    dataQualityNote: { type: 'string' },
  },
  required: ['overallAssessment', 'enhancedPatterns', 'childGuidance'],
};

const WEEKLY_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    overallGrowthAssessment: { type: 'string' },
    strengthsObserved: { type: 'array', items: { type: 'string' } },
    areasToWork: { type: 'array', items: { type: 'string' } },
    parentGuidance: {
      type: 'object',
      properties: {
        whatToFocus: { type: 'string' },
        howToSupport: { type: 'string' },
        timelineToMastery: { type: 'string' },
        estimatedNextUnit: { type: 'string' },
        concreteResources: { type: 'array', items: { type: 'string' } },
      },
      required: ['whatToFocus', 'howToSupport', 'timelineToMastery'],
    },
    weeklyActionPlan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'string' },
          activity: { type: 'string' },
          durationMinutes: { type: 'number' },
        },
        required: ['day', 'activity', 'durationMinutes'],
      },
    },
  },
  required: [
    'overallGrowthAssessment',
    'strengthsObserved',
    'areasToWork',
    'parentGuidance',
    'weeklyActionPlan',
  ],
};

// ============================================================================
// Gemini Enhanced Response Types
// ============================================================================

export interface GeminiEnhancedPattern {
  type: string;
  confidence: number;
  semanticRefinement: string; // Gemini による意味的な補強
  concreteAction: string;     // 具体的な次の一手
}

export interface GeminiDailyAnalysisResponse {
  overallAssessment: string;
  enhancedPatterns: GeminiEnhancedPattern[];
  childGuidance: {
    tone: string;
    nextStepSuggestion: string;
    encouragement: string;
  };
  dataQualityNote?: string;
}

export interface GeminiWeeklyAnalysisResponse {
  overallGrowthAssessment: string;
  strengthsObserved: string[];
  areasToWork: string[];
  parentGuidance: ParentGuidanceContent;
  weeklyActionPlan: Array<{
    day: string;
    activity: string;
    durationMinutes: number;
  }>;
}

// ============================================================================
// Core Gemini Analysis API
// ============================================================================

/**
 * Gemini API を分析用途で呼び出す（JSON 出力強制）
 *
 * @param userPrompt - ユーザープロンプト（会話ログ + heuristic 結果など）
 * @param systemPrompt - システムプロンプト（役割定義）
 * @param responseSchema - 期待する JSON スキーマ
 * @param options - モデル・温度の調整
 */
export async function callGeminiAnalysis<T>(
  userPrompt: string,
  systemPrompt: string,
  responseSchema: object,
  options: {
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
  } = {}
): Promise<T> {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('NEXT_PUBLIC_GEMINI_API_KEY is not set');
  }

  const model = options.model ?? 'gemini-1.5-flash';
  const temperature = options.temperature ?? 0.3; // 分析は低温度で一貫性重視
  const maxOutputTokens = options.maxOutputTokens ?? 2048;

  const requestBody: GeminiAnalysisRequestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema,
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown' } }));
    throw new Error(
      `Gemini Analysis API error (${response.status}): ${
        error.error?.message ?? 'Unknown error'
      }`
    );
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini Analysis: empty response');
  }

  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `Gemini Analysis: failed to parse JSON response: ${
        e instanceof Error ? e.message : 'unknown'
      }\nRaw: ${text.slice(0, 500)}`
    );
  }
}

// ============================================================================
// Daily Analysis Integration
// ============================================================================

/**
 * 日次分析：PatternAnalyzer の結果を Gemini で補強し、DailyAnalysisResult を強化
 *
 * @param messages - 当日の会話ログ（timestamp 付き）
 * @param subject - 教科
 * @param date - YYYY-MM-DD
 * @param options - Gemini 呼び出しオプション
 * @returns Gemini 補強版の DailyAnalysisResult + 原生の GeminiResponse
 */
export async function analyzeDailyWithGemini(
  messages: TimestampedMessage[],
  subject: string,
  date: string,
  options: { model?: string; skipGemini?: boolean } = {}
): Promise<{
  result: DailyAnalysisResult;
  geminiResponse: GeminiDailyAnalysisResponse | null;
}> {
  // Step 1: Heuristic 分析（PatternAnalyzer）
  const analyzer = new PatternAnalyzer();
  const heuristicResult = analyzer.analyzeDaily(messages, subject, date);

  // メッセージが少ない場合は Gemini 呼び出しをスキップ（コスト節約）
  if (options.skipGemini || messages.length < 4) {
    return { result: heuristicResult, geminiResponse: null };
  }

  // Step 2: Gemini プロンプト構築
  const userPrompt = buildDailyAnalysisPrompt(messages, heuristicResult, subject);

  // Step 3: Gemini 呼び出し
  let geminiResponse: GeminiDailyAnalysisResponse;
  try {
    geminiResponse = await callGeminiAnalysis<GeminiDailyAnalysisResponse>(
      userPrompt,
      DAILY_ANALYSIS_SYSTEM_PROMPT,
      DAILY_ANALYSIS_SCHEMA,
      { model: options.model, temperature: 0.3 }
    );
  } catch (e) {
    console.warn('Gemini daily analysis failed, falling back to heuristic:', e);
    return { result: heuristicResult, geminiResponse: null };
  }

  // Step 4: 結果を統合
  const enhancedResult: DailyAnalysisResult = {
    ...heuristicResult,
    overallProgress: geminiResponse.overallAssessment || heuristicResult.overallProgress,
    recommendedActions: mergeRecommendations(
      heuristicResult.recommendedActions,
      geminiResponse.enhancedPatterns.map((p) => p.concreteAction)
    ),
  };

  return { result: enhancedResult, geminiResponse };
}

/**
 * 日次分析プロンプトを構築
 */
function buildDailyAnalysisPrompt(
  messages: TimestampedMessage[],
  heuristicResult: DailyAnalysisResult,
  subject: string
): string {
  const conversationText = messages
    .map((m) => `[${m.role === 'user' ? '子' : 'AI'}] ${m.content}`)
    .join('\n');

  const patternsText = heuristicResult.patterns
    .map((p) => `  - ${p.type} (${p.severity}, confidence=${p.confidence.toFixed(2)}): ${p.topic} | ${p.recommendation ?? ''}`)
    .join('\n');

  return `【分析対象】
教科: ${subject}
日付: ${heuristicResult.date}
メッセージ数: ${messages.length}

【既検出パターン（heuristic）】
${patternsText || '(検出なし)'}

【会話ログ】
${conversationText}

【あなたのタスク】
1. 上記の heuristic パターンを意味論的に検証し、過剰検出/見逃しがあれば指摘
2. 各パターンに具体的な行動（concreteAction）を提案（10分以内で実行可能なもの）
3. 子ども向けガイダンス（childGuidance）を生成：トーン・次ステップ・励まし
4. データ不足の場合は dataQualityNote に明記

JSON で返してください。`;
}

/**
 * heuristic と Gemini の推奨アクションを重複除去しつつマージ
 */
function mergeRecommendations(heuristic: string[], gemini: string[]): string[] {
  const merged = [...heuristic];
  for (const g of gemini) {
    // 類似度チェック（簡易）：先頭10文字一致なら重複とみなす
    const prefix = g.slice(0, 10);
    if (!merged.some((h) => h.startsWith(prefix))) {
      merged.push(g);
    }
  }
  return merged.slice(0, 7); // 最大7件
}

// ============================================================================
// Weekly Analysis Integration
// ============================================================================

/**
 * 週間分析：7日分の DailyAnalysisResult を統合し、親向けレポートを生成
 *
 * @param dailyResults - 7日分の日次分析結果（日付昇順）
 * @param weekLabel - 週ラベル（例: "2026-04-13〜2026-04-19"）
 */
export async function analyzeWeeklyWithGemini(
  dailyResults: DailyAnalysisResult[],
  weekLabel: string,
  options: { model?: string } = {}
): Promise<{
  result: WeeklyReportData;
  geminiResponse: GeminiWeeklyAnalysisResponse | null;
}> {
  if (dailyResults.length === 0) {
    throw new Error('analyzeWeeklyWithGemini: dailyResults is empty');
  }

  const userPrompt = buildWeeklyAnalysisPrompt(dailyResults, weekLabel);

  let geminiResponse: GeminiWeeklyAnalysisResponse | null = null;
  try {
    geminiResponse = await callGeminiAnalysis<GeminiWeeklyAnalysisResponse>(
      userPrompt,
      WEEKLY_ANALYSIS_SYSTEM_PROMPT,
      WEEKLY_ANALYSIS_SCHEMA,
      { model: options.model, temperature: 0.4, maxOutputTokens: 3072 }
    );
  } catch (e) {
    console.warn('Gemini weekly analysis failed, falling back to template:', e);
  }

  // WeeklyReportData を構築
  const subjects: Record<string, WeeklyReportData['subjects'][string]> = {};
  const subjectGroups = groupBySubject(dailyResults);

  for (const [subject, results] of Object.entries(subjectGroups)) {
    subjects[subject] = buildSubjectWeeklyAnalysis(subject, results);
  }

  const result: WeeklyReportData = {
    week: weekLabel,
    subjects,
    overallGrowthAssessment:
      geminiResponse?.overallGrowthAssessment ??
      buildFallbackOverallAssessment(dailyResults),
    parentGuidance:
      geminiResponse?.parentGuidance ?? buildFallbackParentGuidance(dailyResults),
    generatedAt: new Date().toISOString(),
  };

  return { result, geminiResponse };
}

/**
 * 週間分析プロンプトを構築
 */
function buildWeeklyAnalysisPrompt(
  dailyResults: DailyAnalysisResult[],
  weekLabel: string
): string {
  const dailySummaries = dailyResults
    .map((d) => {
      const patternsText = d.patterns
        .map((p: AnalysisPattern) => `    ${p.type}: ${p.topic} (${p.severity})`)
        .join('\n');
      return `[${d.date} / ${d.subject}] msgs=${d.messageCount}
  概要: ${d.overallProgress}
  パターン:
${patternsText || '    (なし)'}`;
    })
    .join('\n\n');

  return `【週間分析対象】
期間: ${weekLabel}
総日数: ${dailyResults.length}日

【日次分析サマリ】
${dailySummaries}

【あなたのタスク】
1. 1週間の成長トレンドを評価（overallGrowthAssessment）
2. 観察できた強み（strengthsObserved）を3つ以上
3. これから伸ばす分野（areasToWork）を具体的に
4. 親向けガイダンス（parentGuidance）：
   - whatToFocus: 今週の重点分野
   - howToSupport: 親の具体的サポート方法（所要時間明示）
   - timelineToMastery: 習得予想期間
   - concreteResources: 具体的な教材・書籍・動画（存在するもののみ）
5. 週末実行プラン（weeklyActionPlan）：土日の具体的な行動

JSON で返してください。`;
}

/**
 * 日次結果を教科別にグループ化
 */
function groupBySubject(
  dailyResults: DailyAnalysisResult[]
): Record<string, DailyAnalysisResult[]> {
  const groups: Record<string, DailyAnalysisResult[]> = {};
  for (const r of dailyResults) {
    if (!groups[r.subject]) groups[r.subject] = [];
    groups[r.subject].push(r);
  }
  return groups;
}

/**
 * 教科別週間分析を構築（heuristic ベース）
 */
function buildSubjectWeeklyAnalysis(
  subject: string,
  results: DailyAnalysisResult[]
): WeeklyReportData['subjects'][string] {
  const topicPerformance: Record<
    string,
    { weekStart: number; weekEnd: number; trend: 'improving' | 'stable' | 'declining' }
  > = {};

  // 単元ごとに週頭と週末の成功率を比較
  const firstDay = results[0];
  const lastDay = results[results.length - 1];

  for (const unit of Object.keys(lastDay.masteryByUnit)) {
    const start = firstDay.masteryByUnit[unit]?.rate ?? 0;
    const end = lastDay.masteryByUnit[unit].rate;
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (end - start > 0.1) trend = 'improving';
    else if (end - start < -0.1) trend = 'declining';

    topicPerformance[unit] = { weekStart: start, weekEnd: end, trend };
  }

  // 成功率変化（全単元平均）
  const avgRates = results.map((r) => {
    const units = Object.values(r.masteryByUnit);
    if (units.length === 0) return 0;
    return units.reduce((sum, u) => sum + u.rate, 0) / units.length;
  });
  const rateChange =
    avgRates.length >= 2 ? avgRates[avgRates.length - 1] - avgRates[0] : 0;
  const successRateChange = `${rateChange >= 0 ? '+' : ''}${Math.round(rateChange * 100)}%`;

  return {
    subject,
    successRateChange,
    topicPerformance,
    recommendations: results
      .flatMap((r) => r.recommendedActions)
      .slice(0, 5),
  };
}

/**
 * Gemini 失敗時の overallGrowthAssessment フォールバック
 */
function buildFallbackOverallAssessment(results: DailyAnalysisResult[]): string {
  const totalMessages = results.reduce((sum, r) => sum + r.messageCount, 0);
  const avgPatternsPerDay =
    results.reduce((sum, r) => sum + r.patterns.length, 0) / results.length;
  return `今週は${results.length}日間で合計${totalMessages}件の学習対話を行いました。1日平均${avgPatternsPerDay.toFixed(
    1
  )}件のパターンを検出しています。詳細は各教科の週間分析をご参照ください。`;
}

/**
 * Gemini 失敗時の親ガイダンス フォールバック
 */
function buildFallbackParentGuidance(
  results: DailyAnalysisResult[]
): ParentGuidanceContent {
  const allRecommendations = results
    .flatMap((r) => r.recommendedActions)
    .filter(Boolean);

  return {
    whatToFocus:
      allRecommendations[0] ??
      '今週検出されたパターンを基に、お子さんと一緒に復習をしてください。',
    howToSupport:
      '週末に15-20分程度、お子さんと一緒に今週の学習内容を振り返ってください。',
    timelineToMastery: '継続的な観察で、来週以降の改善を期待できます。',
  };
}
