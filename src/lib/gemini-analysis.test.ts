/**
 * Gemini Analysis Layer - Unit Tests
 *
 * モック fetch で Gemini API を呼び出さずに動作検証する。
 * - callGeminiAnalysis: API 呼び出しの正常系・異常系
 * - analyzeDailyWithGemini: PatternAnalyzer 統合 + Gemini 補強
 * - analyzeWeeklyWithGemini: 7日分集約 + 親向けガイダンス生成
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  callGeminiAnalysis,
  analyzeDailyWithGemini,
  analyzeWeeklyWithGemini,
  GeminiDailyAnalysisResponse,
  GeminiWeeklyAnalysisResponse,
} from './gemini-analysis';
import {
  TimestampedMessage,
  DailyAnalysisResult,
} from './types/analysis';

// ============================================================================
// Mock Helpers
// ============================================================================

const DUMMY_API_KEY = 'test-api-key-ABCDE';

function mockGeminiResponse(jsonPayload: object, status = 200): Response {
  const body = {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(jsonPayload) }],
        },
      },
    ],
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function mockGeminiErrorResponse(status: number, message: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
  } as unknown as Response;
}

function mockGeminiRawTextResponse(text: string): Response {
  const body = {
    candidates: [
      {
        content: {
          parts: [{ text }],
        },
      },
    ],
  };
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function makeMessage(
  role: 'user' | 'assistant',
  content: string,
  offsetMinutes = 0
): TimestampedMessage {
  const base = new Date('2026-04-19T10:00:00Z');
  base.setMinutes(base.getMinutes() + offsetMinutes);
  return { role, content, timestamp: base.toISOString() };
}

function makeDailyResult(overrides: Partial<DailyAnalysisResult> = {}): DailyAnalysisResult {
  return {
    date: '2026-04-19',
    subject: 'math',
    patterns: [],
    masteryByUnit: {},
    overallProgress: 'base progress',
    recommendedActions: [],
    generatedAt: new Date('2026-04-19T20:00:00Z').toISOString(),
    messageCount: 10,
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

let originalApiKey: string | undefined;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  originalApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  process.env.NEXT_PUBLIC_GEMINI_API_KEY = DUMMY_API_KEY;
  fetchSpy = vi.spyOn(global, 'fetch');
});

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  } else {
    process.env.NEXT_PUBLIC_GEMINI_API_KEY = originalApiKey;
  }
  fetchSpy.mockRestore();
  vi.restoreAllMocks();
});

// ============================================================================
// callGeminiAnalysis
// ============================================================================

describe('callGeminiAnalysis', () => {
  it('正常系：JSON レスポンスを返す', async () => {
    const payload = { result: 'ok', score: 0.9 };
    fetchSpy.mockResolvedValueOnce(mockGeminiResponse(payload));

    const result = await callGeminiAnalysis<typeof payload>(
      'user prompt',
      'system prompt',
      { type: 'object' }
    );

    expect(result).toEqual(payload);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('API KEY がセットされていない場合はエラー', async () => {
    delete process.env.NEXT_PUBLIC_GEMINI_API_KEY;

    await expect(
      callGeminiAnalysis('prompt', 'system', { type: 'object' })
    ).rejects.toThrow('NEXT_PUBLIC_GEMINI_API_KEY is not set');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('HTTP エラー時はステータスを含むエラーを投げる', async () => {
    fetchSpy.mockResolvedValueOnce(mockGeminiErrorResponse(429, 'Rate limit'));

    await expect(
      callGeminiAnalysis('prompt', 'system', { type: 'object' })
    ).rejects.toThrow(/429.*Rate limit/);
  });

  it('空レスポンスはエラーを投げる', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [] }),
    } as unknown as Response);

    await expect(
      callGeminiAnalysis('prompt', 'system', { type: 'object' })
    ).rejects.toThrow('empty response');
  });

  it('不正な JSON はエラーを投げる', async () => {
    fetchSpy.mockResolvedValueOnce(mockGeminiRawTextResponse('this is not JSON'));

    await expect(
      callGeminiAnalysis('prompt', 'system', { type: 'object' })
    ).rejects.toThrow(/failed to parse JSON/);
  });

  it('options でモデル・温度・maxTokens を変更できる', async () => {
    fetchSpy.mockResolvedValueOnce(mockGeminiResponse({ ok: true }));

    await callGeminiAnalysis(
      'prompt',
      'system',
      { type: 'object' },
      { model: 'gemini-1.5-pro', temperature: 0.7, maxOutputTokens: 4096 }
    );

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('gemini-1.5-pro');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.generationConfig.temperature).toBe(0.7);
    expect(body.generationConfig.maxOutputTokens).toBe(4096);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('デフォルト値：gemini-2.5-flash, temperature=0.3, maxTokens=2048', async () => {
    fetchSpy.mockResolvedValueOnce(mockGeminiResponse({ ok: true }));

    await callGeminiAnalysis('prompt', 'system', { type: 'object' });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('gemini-2.5-flash');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.generationConfig.temperature).toBe(0.3);
    expect(body.generationConfig.maxOutputTokens).toBe(2048);
  });

  it('systemInstruction が適切に渡される', async () => {
    fetchSpy.mockResolvedValueOnce(mockGeminiResponse({ ok: true }));

    await callGeminiAnalysis('user', 'MY SYSTEM', { type: 'object' });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.systemInstruction.parts[0].text).toBe('MY SYSTEM');
    expect(body.contents[0].parts[0].text).toBe('user');
  });
});

// ============================================================================
// analyzeDailyWithGemini
// ============================================================================

describe('analyzeDailyWithGemini', () => {
  it('skipGemini=true の場合は heuristic のみ返す（fetch 呼ばれない）', async () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '計算問題を教えて', 0),
      makeMessage('assistant', 'いいよ！', 1),
      makeMessage('user', 'まだわからない', 2),
      makeMessage('assistant', 'もう一度考えてみよう', 3),
    ];

    const { result, geminiResponse } = await analyzeDailyWithGemini(
      messages,
      'math',
      '2026-04-19',
      { skipGemini: true }
    );

    expect(geminiResponse).toBeNull();
    expect(result.date).toBe('2026-04-19');
    expect(result.subject).toBe('math');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('メッセージ 4 件未満なら Gemini スキップ', async () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', 'こんにちは', 0),
      makeMessage('assistant', 'どうしたの？', 1),
    ];

    const { result, geminiResponse } = await analyzeDailyWithGemini(
      messages,
      'math',
      '2026-04-19'
    );

    expect(geminiResponse).toBeNull();
    expect(result.messageCount).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('正常系：Gemini 呼び出し成功で結果が補強される', async () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '繰り上がりの計算問題を教えて', 0),
      makeMessage('assistant', '7+5はどうかな？', 1),
      makeMessage('user', '12かな？', 2),
      makeMessage('assistant', 'その通り！正解です', 3),
      makeMessage('user', 'もう一問！', 4),
      makeMessage('assistant', '8+6は？', 5),
    ];

    const geminiPayload: GeminiDailyAnalysisResponse = {
      overallAssessment: '繰り上がり概念の定着が進んでいます',
      enhancedPatterns: [
        {
          type: 'fluency',
          confidence: 0.85,
          semanticRefinement: '正答スピードが向上',
          concreteAction: 'タングラム遊び 5 分',
        },
      ],
      childGuidance: {
        tone: 'encouraging',
        nextStepSuggestion: '次は 2 桁の足し算に挑戦してみよう',
        encouragement: '今日はよくがんばったね！',
      },
    };

    fetchSpy.mockResolvedValueOnce(mockGeminiResponse(geminiPayload));

    const { result, geminiResponse } = await analyzeDailyWithGemini(
      messages,
      'math',
      '2026-04-19'
    );

    expect(geminiResponse).not.toBeNull();
    expect(geminiResponse?.overallAssessment).toContain('繰り上がり');
    expect(result.overallProgress).toContain('繰り上がり');
    expect(result.recommendedActions).toContain('タングラム遊び 5 分');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('Gemini API 失敗時は heuristic 結果を返す（graceful degradation）', async () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', 'わからない', 0),
      makeMessage('assistant', 'ヒントをあげよう', 1),
      makeMessage('user', 'まだ難しい', 2),
      makeMessage('assistant', 'もう一度考えてみよう', 3),
    ];

    fetchSpy.mockResolvedValueOnce(mockGeminiErrorResponse(500, 'Internal Server'));
    // console.warn を抑制
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result, geminiResponse } = await analyzeDailyWithGemini(
      messages,
      'math',
      '2026-04-19'
    );

    expect(geminiResponse).toBeNull();
    expect(result.date).toBe('2026-04-19');
    expect(result.messageCount).toBe(4);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('recommendedActions がマージされ、重複除去される（max 7 件）', async () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '分数計算を教えて', 0),
      makeMessage('assistant', '1/2 + 1/3 は？', 1),
      makeMessage('user', 'わからない', 2),
      makeMessage('assistant', 'ヒント：通分して考えてみよう', 3),
      makeMessage('user', '5/6？', 4),
      makeMessage('assistant', '正解！', 5),
    ];

    const geminiPayload: GeminiDailyAnalysisResponse = {
      overallAssessment: 'assessment',
      enhancedPatterns: [
        {
          type: 'mastery',
          confidence: 0.7,
          semanticRefinement: 'r1',
          concreteAction: '分数クッキー遊びを 10 分',
        },
        {
          type: 'fluency',
          confidence: 0.6,
          semanticRefinement: 'r2',
          concreteAction: '分数の視覚的な図を描く',
        },
      ],
      childGuidance: {
        tone: 't',
        nextStepSuggestion: 's',
        encouragement: 'e',
      },
    };

    fetchSpy.mockResolvedValueOnce(mockGeminiResponse(geminiPayload));

    const { result } = await analyzeDailyWithGemini(messages, 'math', '2026-04-19');

    expect(result.recommendedActions.length).toBeLessThanOrEqual(7);
    expect(result.recommendedActions).toContain('分数クッキー遊びを 10 分');
    expect(result.recommendedActions).toContain('分数の視覚的な図を描く');
  });

  it('プロンプトに会話ログと heuristic パターンが含まれる', async () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '漢字の読み方を教えて', 0),
      makeMessage('assistant', 'どの漢字？', 1),
      makeMessage('user', '難しい漢字', 2),
      makeMessage('assistant', '例えば「薔薇」は？', 3),
    ];

    fetchSpy.mockResolvedValueOnce(
      mockGeminiResponse({
        overallAssessment: 'x',
        enhancedPatterns: [],
        childGuidance: { tone: 't', nextStepSuggestion: 's', encouragement: 'e' },
      })
    );

    await analyzeDailyWithGemini(messages, 'japanese', '2026-04-19');

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    const userPrompt = body.contents[0].parts[0].text;
    expect(userPrompt).toContain('japanese');
    expect(userPrompt).toContain('2026-04-19');
    expect(userPrompt).toContain('漢字の読み方を教えて');
    expect(userPrompt).toContain('例えば「薔薇」は？');
  });
});

// ============================================================================
// analyzeWeeklyWithGemini
// ============================================================================

describe('analyzeWeeklyWithGemini', () => {
  it('dailyResults が空の場合はエラー', async () => {
    await expect(
      analyzeWeeklyWithGemini([], '2026-04-13〜2026-04-19')
    ).rejects.toThrow(/empty/);
  });

  it('正常系：Gemini 統合で親向けガイダンスが生成される', async () => {
    const dailyResults: DailyAnalysisResult[] = [
      makeDailyResult({
        date: '2026-04-13',
        subject: 'math',
        masteryByUnit: { 計算: { rate: 0.5, attempts: 10, trend: 'stable' } },
      }),
      makeDailyResult({
        date: '2026-04-19',
        subject: 'math',
        masteryByUnit: { 計算: { rate: 0.8, attempts: 15, trend: 'improving' } },
      }),
    ];

    const geminiPayload: GeminiWeeklyAnalysisResponse = {
      overallGrowthAssessment: '計算分野の成長が顕著です',
      strengthsObserved: ['繰り上がり理解', '集中力'],
      areasToWork: ['繰り下がり'],
      parentGuidance: {
        whatToFocus: '繰り下がりの概念',
        howToSupport: 'ブロックで 10 から引く遊びを週 3 回、各 10 分',
        timelineToMastery: '2-3 週間',
        estimatedNextUnit: '2 桁の引き算',
        concreteResources: ['算数ブロック'],
      },
      weeklyActionPlan: [
        { day: '土曜', activity: 'ブロック遊び', durationMinutes: 15 },
      ],
    };

    fetchSpy.mockResolvedValueOnce(mockGeminiResponse(geminiPayload));

    const { result, geminiResponse } = await analyzeWeeklyWithGemini(
      dailyResults,
      '2026-04-13〜2026-04-19'
    );

    expect(geminiResponse).not.toBeNull();
    expect(result.week).toBe('2026-04-13〜2026-04-19');
    expect(result.overallGrowthAssessment).toContain('計算分野');
    expect(result.parentGuidance.whatToFocus).toContain('繰り下がり');
    expect(result.subjects.math).toBeDefined();
    expect(result.subjects.math.topicPerformance['計算'].trend).toBe('improving');
    expect(result.subjects.math.successRateChange).toBe('+30%');
  });

  it('Gemini 失敗時はフォールバックガイダンスで埋める', async () => {
    const dailyResults: DailyAnalysisResult[] = [
      makeDailyResult({
        date: '2026-04-19',
        subject: 'math',
        recommendedActions: ['復習を 10 分'],
      }),
    ];

    fetchSpy.mockResolvedValueOnce(mockGeminiErrorResponse(500, 'fail'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result, geminiResponse } = await analyzeWeeklyWithGemini(
      dailyResults,
      '2026-04-19'
    );

    expect(geminiResponse).toBeNull();
    expect(result.parentGuidance.whatToFocus).toBe('復習を 10 分');
    expect(result.overallGrowthAssessment).toContain('1日間');
    expect(result.subjects.math).toBeDefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('教科別にグループ化される', async () => {
    const dailyResults: DailyAnalysisResult[] = [
      makeDailyResult({ date: '2026-04-13', subject: 'math' }),
      makeDailyResult({ date: '2026-04-14', subject: 'japanese' }),
      makeDailyResult({ date: '2026-04-15', subject: 'math' }),
    ];

    fetchSpy.mockResolvedValueOnce(
      mockGeminiResponse({
        overallGrowthAssessment: 'x',
        strengthsObserved: [],
        areasToWork: [],
        parentGuidance: {
          whatToFocus: 'w',
          howToSupport: 'h',
          timelineToMastery: 't',
        },
        weeklyActionPlan: [],
      })
    );

    const { result } = await analyzeWeeklyWithGemini(dailyResults, 'week');

    expect(Object.keys(result.subjects)).toEqual(
      expect.arrayContaining(['math', 'japanese'])
    );
  });

  it('topicPerformance の trend が週頭→週末の差分で正しく判定される', async () => {
    const dailyResults: DailyAnalysisResult[] = [
      makeDailyResult({
        date: '2026-04-13',
        subject: 'math',
        masteryByUnit: {
          '単元A': { rate: 0.3, attempts: 5, trend: 'stable' },
          '単元B': { rate: 0.9, attempts: 5, trend: 'stable' },
        },
      }),
      makeDailyResult({
        date: '2026-04-19',
        subject: 'math',
        masteryByUnit: {
          '単元A': { rate: 0.8, attempts: 10, trend: 'improving' }, // +0.5 -> improving
          '単元B': { rate: 0.85, attempts: 10, trend: 'stable' },   // -0.05 -> stable
        },
      }),
    ];

    fetchSpy.mockResolvedValueOnce(
      mockGeminiResponse({
        overallGrowthAssessment: 'x',
        strengthsObserved: [],
        areasToWork: [],
        parentGuidance: { whatToFocus: 'w', howToSupport: 'h', timelineToMastery: 't' },
        weeklyActionPlan: [],
      })
    );

    const { result } = await analyzeWeeklyWithGemini(dailyResults, 'week');

    expect(result.subjects.math.topicPerformance['単元A'].trend).toBe('improving');
    expect(result.subjects.math.topicPerformance['単元B'].trend).toBe('stable');
  });

  it('declining trend も検出される', async () => {
    const dailyResults: DailyAnalysisResult[] = [
      makeDailyResult({
        date: '2026-04-13',
        subject: 'math',
        masteryByUnit: { '単元C': { rate: 0.9, attempts: 5, trend: 'stable' } },
      }),
      makeDailyResult({
        date: '2026-04-19',
        subject: 'math',
        masteryByUnit: { '単元C': { rate: 0.5, attempts: 10, trend: 'declining' } },
      }),
    ];

    fetchSpy.mockResolvedValueOnce(
      mockGeminiResponse({
        overallGrowthAssessment: 'x',
        strengthsObserved: [],
        areasToWork: [],
        parentGuidance: { whatToFocus: 'w', howToSupport: 'h', timelineToMastery: 't' },
        weeklyActionPlan: [],
      })
    );

    const { result } = await analyzeWeeklyWithGemini(dailyResults, 'week');

    expect(result.subjects.math.topicPerformance['単元C'].trend).toBe('declining');
  });

  it('generatedAt が現在時刻で設定される', async () => {
    const dailyResults: DailyAnalysisResult[] = [makeDailyResult()];

    fetchSpy.mockResolvedValueOnce(
      mockGeminiResponse({
        overallGrowthAssessment: 'x',
        strengthsObserved: [],
        areasToWork: [],
        parentGuidance: { whatToFocus: 'w', howToSupport: 'h', timelineToMastery: 't' },
        weeklyActionPlan: [],
      })
    );

    const before = Date.now();
    const { result } = await analyzeWeeklyWithGemini(dailyResults, 'week');
    const after = Date.now();

    const generated = new Date(result.generatedAt).getTime();
    expect(generated).toBeGreaterThanOrEqual(before);
    expect(generated).toBeLessThanOrEqual(after);
  });
});
