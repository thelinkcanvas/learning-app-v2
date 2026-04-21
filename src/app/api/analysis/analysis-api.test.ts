/**
 * API Route Unit Tests - /api/analysis/*
 *
 * Next.js の Route Handler を直接呼び出し、バリデーション・エラー処理を検証する。
 * Gemini API 呼び出しは fetch をモックして実際には叩かない。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as dailyPOST } from './[subject]/route';
import { POST as weeklyPOST } from './report/weekly/route';
import {
  DailyAnalysisResult,
  TimestampedMessage,
} from '@/lib/types/analysis';

const DUMMY_API_KEY = 'test-key';

function mockFetchSuccess(payload: object) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
  } as unknown as Response;
}

function makeReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeBadJsonReq(url: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{{not json',
  });
}

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
// POST /api/analysis/[subject]
// ============================================================================

describe('POST /api/analysis/[subject]', () => {
  const URL_BASE = 'http://localhost:3000/api/analysis';

  function makeValidMessages(n = 4): TimestampedMessage[] {
    return Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message ${i}`,
      timestamp: new Date(`2026-04-19T10:${String(i).padStart(2, '0')}:00Z`).toISOString(),
    }));
  }

  it('不正な教科は 400', async () => {
    const req = makeReq(`${URL_BASE}/unknown`, {
      messages: makeValidMessages(),
      date: '2026-04-19',
    });
    const res = await dailyPOST(req, { params: Promise.resolve({ subject: 'unknown' }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid subject/i);
  });

  it('不正な JSON ボディは 400', async () => {
    const req = makeBadJsonReq(`${URL_BASE}/math`);
    const res = await dailyPOST(req, { params: Promise.resolve({ subject: 'math' }) });
    expect(res.status).toBe(400);
  });

  it('messages が配列でない場合は 400', async () => {
    const req = makeReq(`${URL_BASE}/math`, {
      messages: 'not an array',
      date: '2026-04-19',
    });
    const res = await dailyPOST(req, { params: Promise.resolve({ subject: 'math' }) });
    expect(res.status).toBe(400);
  });

  it('日付形式が不正なら 400', async () => {
    const req = makeReq(`${URL_BASE}/math`, {
      messages: makeValidMessages(),
      date: '2026/04/19', // スラッシュ形式は NG
    });
    const res = await dailyPOST(req, { params: Promise.resolve({ subject: 'math' }) });
    expect(res.status).toBe(400);
  });

  it('正常系：skipGemini=true でも 200 返す', async () => {
    const req = makeReq(`${URL_BASE}/math`, {
      messages: makeValidMessages(),
      date: '2026-04-19',
      options: { skipGemini: true },
    });
    const res = await dailyPOST(req, { params: Promise.resolve({ subject: 'math' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result).toBeDefined();
    expect(json.result.subject).toBe('math');
    expect(json.geminiResponse).toBeNull();
    expect(json.meta.processingTimeMs).toBeGreaterThanOrEqual(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('正常系：Gemini が呼ばれて結果が返る', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchSuccess({
        overallAssessment: '好調',
        enhancedPatterns: [],
        childGuidance: { tone: 't', nextStepSuggestion: 'n', encouragement: 'e' },
      })
    );
    const req = makeReq(`${URL_BASE}/math`, {
      messages: makeValidMessages(6),
      date: '2026-04-19',
    });
    const res = await dailyPOST(req, { params: Promise.resolve({ subject: 'math' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.geminiResponse).not.toBeNull();
    expect(json.result.overallProgress).toBe('好調');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('有効な教科すべて受け入れる', async () => {
    const subjects = ['math', 'japanese', 'science', 'social', 'english'];
    for (const s of subjects) {
      const req = makeReq(`${URL_BASE}/${s}`, {
        messages: makeValidMessages(),
        date: '2026-04-19',
        options: { skipGemini: true },
      });
      const res = await dailyPOST(req, { params: Promise.resolve({ subject: s }) });
      expect(res.status).toBe(200);
    }
  });
});

// ============================================================================
// POST /api/analysis/report/weekly
// ============================================================================

describe('POST /api/analysis/report/weekly', () => {
  const URL = 'http://localhost:3000/api/analysis/report/weekly';

  function makeDailyResult(
    overrides: Partial<DailyAnalysisResult> = {}
  ): DailyAnalysisResult {
    return {
      date: '2026-04-19',
      subject: 'math',
      patterns: [],
      masteryByUnit: {},
      overallProgress: 'ok',
      recommendedActions: [],
      generatedAt: '2026-04-19T20:00:00Z',
      messageCount: 5,
      ...overrides,
    };
  }

  it('空の dailyResults は 400', async () => {
    const req = makeReq(URL, { dailyResults: [], weekLabel: 'w' });
    const res = await weeklyPOST(req);
    expect(res.status).toBe(400);
  });

  it('weekLabel 欠如は 400', async () => {
    const req = makeReq(URL, { dailyResults: [makeDailyResult()] });
    const res = await weeklyPOST(req);
    expect(res.status).toBe(400);
  });

  it('dailyResults 内の不正な entry は 400', async () => {
    const req = makeReq(URL, {
      dailyResults: [{ invalid: true }],
      weekLabel: 'week',
    });
    const res = await weeklyPOST(req);
    expect(res.status).toBe(400);
  });

  it('14 日超の dailyResults は 400', async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      makeDailyResult({
        date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      })
    );
    const req = makeReq(URL, { dailyResults: many, weekLabel: 'week' });
    const res = await weeklyPOST(req);
    expect(res.status).toBe(400);
  });

  it('不正な JSON は 400', async () => {
    const res = await weeklyPOST(makeBadJsonReq(URL));
    expect(res.status).toBe(400);
  });

  it('正常系：Gemini 統合で 200 返す', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchSuccess({
        overallGrowthAssessment: '週間成長',
        strengthsObserved: ['s1'],
        areasToWork: ['a1'],
        parentGuidance: {
          whatToFocus: 'f',
          howToSupport: 'h',
          timelineToMastery: 't',
        },
        weeklyActionPlan: [],
      })
    );

    const req = makeReq(URL, {
      dailyResults: [makeDailyResult()],
      weekLabel: '2026-04-19',
    });
    const res = await weeklyPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.week).toBe('2026-04-19');
    expect(json.result.overallGrowthAssessment).toBe('週間成長');
    expect(json.meta.daysProcessed).toBe(1);
    expect(json.meta.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('Gemini 失敗時もフォールバックで 200 返す', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'fail' } }),
    } as unknown as Response);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const req = makeReq(URL, {
      dailyResults: [makeDailyResult({ recommendedActions: ['復習'] })],
      weekLabel: '2026-04-19',
    });
    const res = await weeklyPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.geminiResponse).toBeNull();
    expect(json.result.parentGuidance.whatToFocus).toBe('復習');
    expect(warnSpy).toHaveBeenCalled();
  });
});
