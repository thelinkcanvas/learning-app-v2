/**
 * Integration Tests - V2 Full Flow
 *
 * エンドツーエンドで以下をモック fetch で検証:
 *
 * Scenario A: 当日分析フロー
 *   会話ログ → PatternAnalyzer → Gemini 補強 → DailyAnalysisResult 保存
 *
 * Scenario B: 週間レポートフロー
 *   5日分の daily → 週間集約 → Gemini 親ガイダンス → WeeklyReport 保存
 *
 * Scenario C: エラー耐性
 *   Gemini 失敗 → heuristic fallback で UI 壊れず継続
 *
 * Scenario D: コスト追跡
 *   実行毎に cost summary が加算、月間予算超過で警告
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { analyzeDailyWithGemini, analyzeWeeklyWithGemini } from './gemini-analysis';
import { PatternAnalyzer } from './pattern-analyzer';
import {
  saveDailyAnalysis,
  loadDailyAnalysis,
  loadDailyAnalysisRange,
  saveWeeklyReport,
  loadWeeklyReport,
  clearAllAnalysisData,
} from './storage';
import {
  addCostEntry,
  createEmptyCostSummary,
  checkBudgetWarning,
  decideSchedule,
  toJstDateString,
} from './scheduler';
import { TimestampedMessage } from './types/analysis';

// ============================================================================
// localStorage mock
// ============================================================================

class LocalStorageMock {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}

function mockGeminiDaily(payload: object) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
  } as unknown as Response;
}

function makeMessage(role: 'user' | 'assistant', content: string, offsetMin: number, date = '2026-04-22'): TimestampedMessage {
  const base = new Date(`${date}T10:00:00Z`);
  base.setMinutes(base.getMinutes() + offsetMin);
  return { role, content, timestamp: base.toISOString() };
}

let originalKey: string | undefined;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  originalKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  process.env.NEXT_PUBLIC_GEMINI_API_KEY = 'test-key';

  const mock = new LocalStorageMock();
  const g = globalThis as unknown as { window?: { localStorage?: LocalStorageMock }; localStorage?: LocalStorageMock };
  g.window = g.window ?? ({} as { localStorage?: LocalStorageMock });
  g.localStorage = mock;
  g.window.localStorage = mock;

  fetchSpy = vi.spyOn(global, 'fetch');
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  else process.env.NEXT_PUBLIC_GEMINI_API_KEY = originalKey;
  fetchSpy.mockRestore();
  const g = globalThis as unknown as { window?: unknown; localStorage?: unknown };
  delete g.localStorage;
  delete g.window;
  vi.restoreAllMocks();
});

// ============================================================================
// Scenario A: Daily flow
// ============================================================================

describe('Scenario A: 当日分析フロー', () => {
  it('会話 → 分析 → 保存 → 再読み込みで一致', async () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '繰り上がりの計算を教えて', 0),
      makeMessage('assistant', '7+5はどうかな？', 1),
      makeMessage('user', '12！', 2),
      makeMessage('assistant', 'その通り！正解です', 3),
      makeMessage('user', '次も挑戦したい', 4),
      makeMessage('assistant', '8+6は？', 5),
    ];

    fetchSpy.mockResolvedValueOnce(
      mockGeminiDaily({
        overallAssessment: '繰り上がりの理解が進んでいます',
        enhancedPatterns: [
          {
            type: 'fluency',
            confidence: 0.8,
            semanticRefinement: '正答までのターンが短い',
            concreteAction: '類題を3問チャレンジ',
          },
        ],
        childGuidance: {
          tone: 'encouraging',
          nextStepSuggestion: '2桁の足し算へ',
          encouragement: 'がんばったね',
        },
      })
    );

    // 分析実行
    const { result, geminiResponse } = await analyzeDailyWithGemini(
      messages,
      'math',
      '2026-04-22'
    );

    expect(geminiResponse).not.toBeNull();
    expect(result.overallProgress).toContain('繰り上がり');

    // localStorage に保存
    expect(saveDailyAnalysis(result)).toBe(true);

    // 再読み込み
    const reloaded = loadDailyAnalysis('math', '2026-04-22');
    expect(reloaded).not.toBeNull();
    expect(reloaded?.date).toBe('2026-04-22');
    expect(reloaded?.subject).toBe('math');
    expect(reloaded?.overallProgress).toBe(result.overallProgress);
  });

  it('PatternAnalyzer 単独でも動く（Gemini 呼ばずヒューリスティックのみ）', async () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '分数の問題', 0),
      makeMessage('assistant', '1/2+1/3は？', 1),
    ];

    const analyzer = new PatternAnalyzer();
    const result = analyzer.analyzeDaily(messages, 'math', '2026-04-22');

    expect(result.date).toBe('2026-04-22');
    expect(result.subject).toBe('math');
    expect(result.messageCount).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Scenario B: Weekly flow
// ============================================================================

describe('Scenario B: 週間レポートフロー', () => {
  it('5日分 daily → 週間分析 → 親ガイダンス取得', async () => {
    // 5日分の daily を保存
    for (let i = 0; i < 5; i++) {
      const date = new Date('2026-04-20T00:00:00Z');
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().slice(0, 10);

      saveDailyAnalysis({
        date: dateStr,
        subject: 'math',
        patterns: [],
        masteryByUnit: {
          計算: { rate: 0.5 + i * 0.1, attempts: 10, trend: 'improving' },
        },
        overallProgress: `Day ${i}`,
        recommendedActions: ['復習'],
        generatedAt: `${dateStr}T20:00:00Z`,
        messageCount: 10,
      });
    }

    // 週間分析モック
    fetchSpy.mockResolvedValueOnce(
      mockGeminiDaily({
        overallGrowthAssessment: '5日で計算力が+50%',
        strengthsObserved: ['繰り上がり理解', '集中力維持', '自主性'],
        areasToWork: ['繰り下がり'],
        parentGuidance: {
          whatToFocus: '繰り下がりの概念',
          howToSupport: 'ブロックで10を引く遊びを週3回、各10分',
          timelineToMastery: '2週間',
          estimatedNextUnit: '2桁の引き算',
          concreteResources: ['算数ブロック'],
        },
        weeklyActionPlan: [{ day: '土', activity: 'ブロック遊び', durationMinutes: 15 }],
      })
    );

    // 週間範囲取得
    const results = loadDailyAnalysisRange('math', '2026-04-20', '2026-04-24');
    expect(results).toHaveLength(5);

    // 週間分析実行
    const { result, geminiResponse } = await analyzeWeeklyWithGemini(
      results,
      '2026-04-20〜2026-04-26'
    );

    expect(geminiResponse).not.toBeNull();
    expect(result.parentGuidance.whatToFocus).toContain('繰り下がり');
    expect(result.subjects.math.successRateChange).toBe('+40%'); // 0.5 → 0.9

    // 保存 & 再読み込み
    expect(saveWeeklyReport('2026-04-20', result)).toBe(true);
    const reloaded = loadWeeklyReport('2026-04-20');
    expect(reloaded?.parentGuidance.whatToFocus).toContain('繰り下がり');
  });

  it('週間データ無しで分析 → エラー', async () => {
    await expect(analyzeWeeklyWithGemini([], 'empty week')).rejects.toThrow(/empty/);
  });
});

// ============================================================================
// Scenario C: Error resilience
// ============================================================================

describe('Scenario C: エラー耐性', () => {
  it('Gemini 500 でも heuristic fallback で結果を返す', async () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', '助けて', 0),
      makeMessage('assistant', 'どうした？', 1),
      makeMessage('user', 'わからない', 2),
      makeMessage('assistant', 'ヒントを出すよ', 3),
    ];

    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Internal' } }),
    } as unknown as Response);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result, geminiResponse } = await analyzeDailyWithGemini(
      messages,
      'math',
      '2026-04-22'
    );

    expect(geminiResponse).toBeNull();
    expect(result).toBeDefined();
    expect(result.subject).toBe('math');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('Gemini タイムアウト風エラーでも graceful', async () => {
    const messages: TimestampedMessage[] = [
      makeMessage('user', 'test', 0),
      makeMessage('assistant', 'ok', 1),
      makeMessage('user', 'more', 2),
      makeMessage('assistant', 'sure', 3),
    ];

    fetchSpy.mockRejectedValueOnce(new Error('Network timeout'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = await analyzeDailyWithGemini(messages, 'math', '2026-04-22');
    expect(result).toBeDefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ============================================================================
// Scenario D: Cost tracking + scheduling
// ============================================================================

describe('Scenario D: コスト追跡 + スケジューリング', () => {
  it('30日分の daily 実行で 900円', () => {
    let summary = createEmptyCostSummary();
    for (let i = 0; i < 30; i++) {
      summary = addCostEntry(summary, {
        kind: 'daily',
        timestamp: `2026-04-${String(i % 30 + 1).padStart(2, '0')}T20:00:00Z`,
      });
    }
    expect(summary.totalCost).toBe(900);
    expect(summary.dailyCalls).toBe(30);
  });

  it('月間予算 ¥2000 シミュレーション（daily30 + weekly4 + α）', () => {
    let summary = createEmptyCostSummary();
    // daily x 30 = 900
    for (let i = 0; i < 30; i++) {
      summary = addCostEntry(summary, {
        kind: 'daily',
        timestamp: `2026-04-${String(i % 30 + 1).padStart(2, '0')}T20:00:00Z`,
      });
    }
    // weekly x 4 = 400
    for (let i = 0; i < 4; i++) {
      summary = addCostEntry(summary, {
        kind: 'weekly',
        timestamp: `2026-04-${String(5 + i * 7).padStart(2, '0')}T22:00:00Z`,
      });
    }
    expect(summary.byMonth['2026-04']).toBe(1300); // 900 + 400
    expect(summary.byMonth['2026-04']).toBeLessThanOrEqual(2000);

    const check = checkBudgetWarning(summary, '2026-04');
    expect(check.warning).toBe(false);
    expect(check.percent).toBeLessThan(80);
  });

  it('異常使用時 ¥2000 超過で警告', () => {
    let summary = createEmptyCostSummary();
    // weekly を 25 回（異常）
    for (let i = 0; i < 25; i++) {
      summary = addCostEntry(summary, {
        kind: 'weekly',
        timestamp: '2026-04-15T22:00:00Z',
      });
    }
    const check = checkBudgetWarning(summary, '2026-04');
    expect(check.warning).toBe(true);
    expect(check.message).toMatch(/予算超過|予算警告/);
  });

  it('スケジューラが JST 20時以降のみ daily トリガー', () => {
    // JST 19:59 = UTC 10:59
    const before = decideSchedule(new Date('2026-04-22T10:59:00Z'), {});
    expect(before.shouldRun).toBe(false);

    // JST 20:00 = UTC 11:00
    const on = decideSchedule(new Date('2026-04-22T11:00:00Z'), {});
    expect(on.shouldRun).toBe(true);
    expect(on.kind).toBe('daily');
  });

  it('金曜 22時で weekly 優先、daily は翌日再トリガー', () => {
    // 2026-04-24 金 JST 22:00
    const dec = decideSchedule(new Date('2026-04-24T13:00:00Z'), {});
    expect(dec.kind).toBe('weekly');

    // 翌日土曜 20:00
    const dec2 = decideSchedule(new Date('2026-04-25T11:00:00Z'), { lastWeeklyRunDate: '2026-04-24' });
    expect(dec2.kind).toBe('daily');
    expect(dec2.targetDate).toBe('2026-04-25');
  });
});

// ============================================================================
// Scenario E: Storage maintenance
// ============================================================================

describe('Scenario E: Storage メンテナンス', () => {
  it('clearAllAnalysisData で V2 データのみ消去、MVP conversation は保持', () => {
    // V2 データ
    saveDailyAnalysis({
      date: '2026-04-22',
      subject: 'math',
      patterns: [],
      masteryByUnit: {},
      overallProgress: 'test',
      recommendedActions: [],
      generatedAt: '2026-04-22T20:00:00Z',
      messageCount: 5,
    });
    // MVP データ
    localStorage.setItem(
      'conversation_math_2026-04-22',
      JSON.stringify([{ role: 'user', content: 'test' }])
    );

    const deleted = clearAllAnalysisData();
    expect(deleted).toBeGreaterThan(0);
    expect(loadDailyAnalysis('math', '2026-04-22')).toBeNull();
    // MVP 側は生き残る
    expect(localStorage.getItem('conversation_math_2026-04-22')).not.toBeNull();
  });

  it('toJstDateString は session 不問で一貫した JST 日付を返す', () => {
    // UTC が日付跨ぎ付近でも JST で一貫
    const a = toJstDateString(new Date('2026-04-22T14:59:00Z')); // JST 23:59
    const b = toJstDateString(new Date('2026-04-22T15:01:00Z')); // JST 00:01 翌日
    expect(a).toBe('2026-04-22');
    expect(b).toBe('2026-04-23');
  });
});
