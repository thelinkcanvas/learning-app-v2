/**
 * Storage Layer V2 - Unit Tests
 *
 * localStorage をモックして CRUD・インデックス・プルーン動作を検証する。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  STORAGE_KEYS,
  saveDailyAnalysis,
  loadDailyAnalysis,
  deleteDailyAnalysis,
  loadDailyAnalysisRange,
  listDailyAnalysisKeys,
  saveWeeklyReport,
  loadWeeklyReport,
  deleteWeeklyReport,
  listWeeklyReportKeys,
  clearAllAnalysisData,
  pruneOldAnalysisData,
  estimateAnalysisStorageSize,
  loadConversationAsTimestamped,
} from './storage';
import {
  DailyAnalysisResult,
  WeeklyReportData,
} from './types/analysis';

// ============================================================================
// localStorage mock (node 環境で localStorage を使えるようにする)
// ============================================================================

class LocalStorageMock {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
}

function installLocalStorage() {
  const mock = new LocalStorageMock();
  const g = globalThis as unknown as {
    window?: { localStorage?: LocalStorageMock };
    localStorage?: LocalStorageMock;
  };
  g.window = g.window ?? ({} as { localStorage?: LocalStorageMock });
  g.localStorage = mock;
  g.window.localStorage = mock;
  return mock;
}

function uninstallLocalStorage() {
  const g = globalThis as unknown as {
    window?: unknown;
    localStorage?: unknown;
  };
  delete g.localStorage;
  delete g.window;
}

// ============================================================================
// Fixtures
// ============================================================================

function makeDailyResult(overrides: Partial<DailyAnalysisResult> = {}): DailyAnalysisResult {
  return {
    date: '2026-04-19',
    subject: 'math',
    patterns: [],
    masteryByUnit: { 計算: { rate: 0.8, attempts: 10, trend: 'improving' } },
    overallProgress: 'OK',
    recommendedActions: ['復習しよう'],
    generatedAt: '2026-04-19T20:00:00.000Z',
    messageCount: 12,
    ...overrides,
  };
}

function makeWeeklyReport(overrides: Partial<WeeklyReportData> = {}): WeeklyReportData {
  return {
    week: '2026-04-13〜2026-04-19',
    subjects: {
      math: {
        subject: 'math',
        successRateChange: '+10%',
        topicPerformance: {},
        recommendations: [],
      },
    },
    overallGrowthAssessment: '成長中',
    parentGuidance: {
      whatToFocus: '計算',
      howToSupport: '毎日 10 分',
      timelineToMastery: '2 週間',
    },
    generatedAt: '2026-04-19T22:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  installLocalStorage();
});

afterEach(() => {
  uninstallLocalStorage();
  vi.restoreAllMocks();
});

// ============================================================================
// Key builders
// ============================================================================

describe('STORAGE_KEYS', () => {
  it('conversation key は MVP 形式と一致する', () => {
    expect(STORAGE_KEYS.conversation('math', '2026-04-19')).toBe(
      'conversation_math_2026-04-19'
    );
  });

  it('analysis key は V2 形式', () => {
    expect(STORAGE_KEYS.analysis('math', '2026-04-19')).toBe(
      'analysis_math_2026-04-19'
    );
  });

  it('weekly report key は V2 形式', () => {
    expect(STORAGE_KEYS.weeklyReport('2026-04-13')).toBe(
      'weekly_report_2026-04-13'
    );
  });
});

// ============================================================================
// Daily Analysis CRUD
// ============================================================================

describe('Daily Analysis CRUD', () => {
  it('save → load で同一データが返る', () => {
    const data = makeDailyResult();
    expect(saveDailyAnalysis(data)).toBe(true);
    const loaded = loadDailyAnalysis('math', '2026-04-19');
    expect(loaded).toEqual(data);
  });

  it('存在しないキーは null を返す', () => {
    expect(loadDailyAnalysis('math', '2099-01-01')).toBeNull();
  });

  it('delete で削除される', () => {
    saveDailyAnalysis(makeDailyResult());
    expect(loadDailyAnalysis('math', '2026-04-19')).not.toBeNull();
    expect(deleteDailyAnalysis('math', '2026-04-19')).toBe(true);
    expect(loadDailyAnalysis('math', '2026-04-19')).toBeNull();
  });

  it('listDailyAnalysisKeys は保存済みキーを返す', () => {
    saveDailyAnalysis(makeDailyResult({ date: '2026-04-18' }));
    saveDailyAnalysis(makeDailyResult({ date: '2026-04-19' }));
    const keys = listDailyAnalysisKeys();
    expect(keys).toContain('analysis_math_2026-04-18');
    expect(keys).toContain('analysis_math_2026-04-19');
  });

  it('同じキーで save 2 回してもインデックス重複しない', () => {
    saveDailyAnalysis(makeDailyResult());
    saveDailyAnalysis(makeDailyResult({ overallProgress: 'updated' }));
    const keys = listDailyAnalysisKeys();
    const target = keys.filter((k) => k === 'analysis_math_2026-04-19');
    expect(target.length).toBe(1);
    expect(loadDailyAnalysis('math', '2026-04-19')?.overallProgress).toBe('updated');
  });
});

// ============================================================================
// Daily Analysis Range
// ============================================================================

describe('loadDailyAnalysisRange', () => {
  beforeEach(() => {
    saveDailyAnalysis(makeDailyResult({ date: '2026-04-13', subject: 'math' }));
    saveDailyAnalysis(makeDailyResult({ date: '2026-04-15', subject: 'math' }));
    saveDailyAnalysis(makeDailyResult({ date: '2026-04-19', subject: 'math' }));
    saveDailyAnalysis(makeDailyResult({ date: '2026-04-17', subject: 'japanese' }));
  });

  it('教科指定で絞り込める', () => {
    const results = loadDailyAnalysisRange('math', '2026-04-13', '2026-04-19');
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.subject === 'math')).toBe(true);
  });

  it('subject=null で全教科を取得', () => {
    const results = loadDailyAnalysisRange(null, '2026-04-13', '2026-04-19');
    expect(results).toHaveLength(4);
  });

  it('日付範囲で絞り込める', () => {
    const results = loadDailyAnalysisRange('math', '2026-04-14', '2026-04-18');
    expect(results).toHaveLength(1);
    expect(results[0].date).toBe('2026-04-15');
  });

  it('結果は日付昇順でソート', () => {
    const results = loadDailyAnalysisRange('math', '2026-04-13', '2026-04-19');
    expect(results.map((r) => r.date)).toEqual([
      '2026-04-13',
      '2026-04-15',
      '2026-04-19',
    ]);
  });

  it('範囲外なら空配列', () => {
    expect(loadDailyAnalysisRange('math', '2030-01-01', '2030-01-07')).toEqual([]);
  });
});

// ============================================================================
// Weekly Report CRUD
// ============================================================================

describe('Weekly Report CRUD', () => {
  it('save → load', () => {
    const report = makeWeeklyReport();
    expect(saveWeeklyReport('2026-04-13', report)).toBe(true);
    expect(loadWeeklyReport('2026-04-13')).toEqual(report);
  });

  it('存在しない週は null', () => {
    expect(loadWeeklyReport('2099-01-01')).toBeNull();
  });

  it('delete で削除', () => {
    saveWeeklyReport('2026-04-13', makeWeeklyReport());
    expect(deleteWeeklyReport('2026-04-13')).toBe(true);
    expect(loadWeeklyReport('2026-04-13')).toBeNull();
  });

  it('listWeeklyReportKeys', () => {
    saveWeeklyReport('2026-04-06', makeWeeklyReport());
    saveWeeklyReport('2026-04-13', makeWeeklyReport());
    const keys = listWeeklyReportKeys();
    expect(keys).toContain('weekly_report_2026-04-06');
    expect(keys).toContain('weekly_report_2026-04-13');
  });
});

// ============================================================================
// MVP Compatibility
// ============================================================================

describe('loadConversationAsTimestamped (MVP compat)', () => {
  it('MVP 形式（timestamp なし）でも読み込める', () => {
    // MVP の saveConversationToLocalStorage と同じ形式で直接保存
    const key = 'conversation_math_2026-04-19';
    localStorage.setItem(
      key,
      JSON.stringify([
        { role: 'user', content: 'こんにちは' },
        { role: 'assistant', content: 'どうしたの？' },
      ])
    );

    const messages = loadConversationAsTimestamped('math', '2026-04-19');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('こんにちは');
    expect(messages[0].timestamp).toMatch(/2026-04-19T/);
    // 5 分間隔で推定されている
    const t0 = new Date(messages[0].timestamp).getTime();
    const t1 = new Date(messages[1].timestamp).getTime();
    expect(t1 - t0).toBe(5 * 60 * 1000);
  });

  it('V2 形式（timestamp 付き）はそのまま返す', () => {
    const key = 'conversation_math_2026-04-19';
    const original = [
      {
        role: 'user',
        content: 'hello',
        timestamp: '2026-04-19T11:00:00.000Z',
      },
      {
        role: 'assistant',
        content: 'hi',
        timestamp: '2026-04-19T11:01:00.000Z',
      },
    ];
    localStorage.setItem(key, JSON.stringify(original));

    const messages = loadConversationAsTimestamped('math', '2026-04-19');
    expect(messages).toEqual(original);
  });

  it('存在しない場合は空配列', () => {
    expect(loadConversationAsTimestamped('math', '2099-01-01')).toEqual([]);
  });

  it('不正な JSON は空配列', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('conversation_math_2026-04-19', '{{{invalid}}}');
    expect(loadConversationAsTimestamped('math', '2026-04-19')).toEqual([]);
    expect(errSpy).toHaveBeenCalled();
  });
});

// ============================================================================
// Maintenance
// ============================================================================

describe('clearAllAnalysisData', () => {
  it('分析データのみ削除、MVP の conversation_* は残る', () => {
    saveDailyAnalysis(makeDailyResult());
    saveWeeklyReport('2026-04-13', makeWeeklyReport());
    localStorage.setItem(
      'conversation_math_2026-04-19',
      JSON.stringify([{ role: 'user', content: 'test' }])
    );

    const deleted = clearAllAnalysisData();
    expect(deleted).toBeGreaterThanOrEqual(2);
    expect(loadDailyAnalysis('math', '2026-04-19')).toBeNull();
    expect(loadWeeklyReport('2026-04-13')).toBeNull();
    expect(localStorage.getItem('conversation_math_2026-04-19')).not.toBeNull();
  });
});

describe('pruneOldAnalysisData', () => {
  it('古い分析結果のみ削除される', () => {
    const today = new Date();
    const old = new Date(today);
    old.setDate(old.getDate() - 100);
    const recent = new Date(today);
    recent.setDate(recent.getDate() - 5);

    const oldDate = old.toISOString().slice(0, 10);
    const recentDate = recent.toISOString().slice(0, 10);

    saveDailyAnalysis(makeDailyResult({ date: oldDate }));
    saveDailyAnalysis(makeDailyResult({ date: recentDate }));

    const deleted = pruneOldAnalysisData(30);
    expect(deleted).toBe(1);
    expect(loadDailyAnalysis('math', oldDate)).toBeNull();
    expect(loadDailyAnalysis('math', recentDate)).not.toBeNull();
  });

  it('週間レポートも対象', () => {
    const old = new Date();
    old.setDate(old.getDate() - 100);
    const oldWeek = old.toISOString().slice(0, 10);

    saveWeeklyReport(oldWeek, makeWeeklyReport());
    const deleted = pruneOldAnalysisData(30);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(loadWeeklyReport(oldWeek)).toBeNull();
  });

  it('retainDays=0 なら過去日付のみ削除、当日は残る', () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);

    saveDailyAnalysis(makeDailyResult({ date: today }));
    saveDailyAnalysis(makeDailyResult({ date: yesterday }));

    pruneOldAnalysisData(0);
    expect(loadDailyAnalysis('math', today)).not.toBeNull();
    expect(loadDailyAnalysis('math', yesterday)).toBeNull();
  });
});

describe('estimateAnalysisStorageSize', () => {
  it('0 件なら 0 バイト', () => {
    expect(estimateAnalysisStorageSize()).toBe(0);
  });

  it('データを保存すると増える', () => {
    const before = estimateAnalysisStorageSize();
    saveDailyAnalysis(makeDailyResult());
    const after = estimateAnalysisStorageSize();
    expect(after).toBeGreaterThan(before);
  });
});

// ============================================================================
// SSR safety (window undefined)
// ============================================================================

describe('SSR safety', () => {
  it('window が undefined でも throw しない', () => {
    uninstallLocalStorage();
    expect(saveDailyAnalysis(makeDailyResult())).toBe(false);
    expect(loadDailyAnalysis('math', '2026-04-19')).toBeNull();
    expect(listDailyAnalysisKeys()).toEqual([]);
    expect(loadDailyAnalysisRange(null, '2026-04-13', '2026-04-19')).toEqual([]);
    expect(clearAllAnalysisData()).toBe(0);
    expect(pruneOldAnalysisData()).toBe(0);
    expect(estimateAnalysisStorageSize()).toBe(0);
  });
});
