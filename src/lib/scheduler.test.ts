/**
 * Scheduler Logic - Unit Tests
 *
 * Date の JST 変換・スケジュール判定・コスト計算を検証
 */

import { describe, it, expect } from 'vitest';
import {
  toJstDateString,
  getJstHour,
  getJstDayOfWeek,
  getJstMondayOfWeek,
  decideSchedule,
  addCostEntry,
  createEmptyCostSummary,
  checkBudgetWarning,
  DAILY_COST_ESTIMATE,
  WEEKLY_COST_ESTIMATE,
  MONTHLY_COST_BUDGET,
  SchedulerState,
} from './scheduler';

// ============================================================================
// Date utilities
// ============================================================================

describe('toJstDateString', () => {
  it('UTC から JST 日付を計算', () => {
    // 2026-04-22 10:00 UTC = 2026-04-22 19:00 JST
    const d = new Date('2026-04-22T10:00:00Z');
    expect(toJstDateString(d)).toBe('2026-04-22');
  });

  it('UTC 夜 → JST 翌日 に変換', () => {
    // 2026-04-22 16:00 UTC = 2026-04-23 01:00 JST
    const d = new Date('2026-04-22T16:00:00Z');
    expect(toJstDateString(d)).toBe('2026-04-23');
  });

  it('UTC 早朝 → JST 同日昼', () => {
    // 2026-04-22 01:00 UTC = 2026-04-22 10:00 JST
    const d = new Date('2026-04-22T01:00:00Z');
    expect(toJstDateString(d)).toBe('2026-04-22');
  });
});

describe('getJstHour', () => {
  it('JST 20時は UTC 11時', () => {
    const d = new Date('2026-04-22T11:00:00Z');
    expect(getJstHour(d)).toBe(20);
  });

  it('JST 22時は UTC 13時', () => {
    const d = new Date('2026-04-22T13:00:00Z');
    expect(getJstHour(d)).toBe(22);
  });

  it('JST 0時は UTC 前日15時', () => {
    const d = new Date('2026-04-21T15:00:00Z');
    expect(getJstHour(d)).toBe(0);
  });
});

describe('getJstDayOfWeek', () => {
  it('2026-04-22 は水曜日', () => {
    const d = new Date('2026-04-22T12:00:00Z');
    expect(getJstDayOfWeek(d)).toBe(3); // Wednesday
  });

  it('2026-04-24 は金曜日', () => {
    const d = new Date('2026-04-24T12:00:00Z');
    expect(getJstDayOfWeek(d)).toBe(5); // Friday
  });

  it('2026-04-26 は日曜日', () => {
    const d = new Date('2026-04-26T12:00:00Z');
    expect(getJstDayOfWeek(d)).toBe(0); // Sunday
  });
});

describe('getJstMondayOfWeek', () => {
  it('水曜日から月曜日を計算', () => {
    // 2026-04-22 水 → 2026-04-20 月
    const d = new Date('2026-04-22T12:00:00Z');
    expect(getJstMondayOfWeek(d)).toBe('2026-04-20');
  });

  it('月曜日なら自身', () => {
    const d = new Date('2026-04-20T12:00:00Z');
    expect(getJstMondayOfWeek(d)).toBe('2026-04-20');
  });

  it('日曜日は前週の月曜', () => {
    // 2026-04-26 日 → 2026-04-20 月
    const d = new Date('2026-04-26T12:00:00Z');
    expect(getJstMondayOfWeek(d)).toBe('2026-04-20');
  });

  it('土曜日は同週の月曜', () => {
    // 2026-04-25 土 → 2026-04-20 月
    const d = new Date('2026-04-25T12:00:00Z');
    expect(getJstMondayOfWeek(d)).toBe('2026-04-20');
  });
});

// ============================================================================
// decideSchedule
// ============================================================================

describe('decideSchedule', () => {
  const emptyState: SchedulerState = {};

  it('JST 19時台なら何も実行しない', () => {
    // JST 19:00 = UTC 10:00
    const d = new Date('2026-04-22T10:00:00Z');
    const dec = decideSchedule(d, emptyState);
    expect(dec.shouldRun).toBe(false);
    expect(dec.kind).toBe('none');
  });

  it('JST 20時ぴったりなら daily 実行', () => {
    // JST 20:00 = UTC 11:00
    const d = new Date('2026-04-22T11:00:00Z');
    const dec = decideSchedule(d, emptyState);
    expect(dec.shouldRun).toBe(true);
    expect(dec.kind).toBe('daily');
    expect(dec.targetDate).toBe('2026-04-22');
  });

  it('JST 20:01 でも daily 実行', () => {
    const d = new Date('2026-04-22T11:01:00Z');
    const dec = decideSchedule(d, emptyState);
    expect(dec.shouldRun).toBe(true);
    expect(dec.kind).toBe('daily');
  });

  it('既に当日 daily 実行済みならスキップ（平日）', () => {
    const d = new Date('2026-04-22T11:30:00Z'); // JST 20:30 水曜
    const dec = decideSchedule(d, { lastDailyRunDate: '2026-04-22' });
    expect(dec.shouldRun).toBe(false);
    expect(dec.reason).toMatch(/already ran/);
  });

  it('翌日になれば再度 daily 実行', () => {
    // 2026-04-23 JST 20:30 = UTC 11:30
    const d = new Date('2026-04-23T11:30:00Z');
    const dec = decideSchedule(d, { lastDailyRunDate: '2026-04-22' });
    expect(dec.shouldRun).toBe(true);
    expect(dec.kind).toBe('daily');
    expect(dec.targetDate).toBe('2026-04-23');
  });

  it('金曜 JST 22:00+ なら weekly 優先', () => {
    // 2026-04-24 金 JST 22:00 = UTC 13:00
    const d = new Date('2026-04-24T13:00:00Z');
    const dec = decideSchedule(d, emptyState);
    expect(dec.shouldRun).toBe(true);
    expect(dec.kind).toBe('weekly');
    expect(dec.targetDate).toBe('2026-04-24');
    expect(dec.targetWeekStart).toBe('2026-04-20');
  });

  it('金曜 JST 20:00 はまだ daily のみ（weekly は 22時以降）', () => {
    // 2026-04-24 金 JST 20:00 = UTC 11:00
    const d = new Date('2026-04-24T11:00:00Z');
    const dec = decideSchedule(d, emptyState);
    expect(dec.shouldRun).toBe(true);
    expect(dec.kind).toBe('daily');
  });

  it('金曜 weekly 既実行済みなら daily のみ実行', () => {
    // 2026-04-24 金 JST 22:30 で weekly 済み、daily 未実行
    const d = new Date('2026-04-24T13:30:00Z');
    const dec = decideSchedule(d, { lastWeeklyRunDate: '2026-04-24' });
    expect(dec.shouldRun).toBe(true);
    expect(dec.kind).toBe('daily');
  });

  it('オプションで時刻をカスタマイズ可能', () => {
    // JST 18:00 = UTC 09:00
    const d = new Date('2026-04-22T09:00:00Z');
    const dec = decideSchedule(d, emptyState, { dailyHour: 18 });
    expect(dec.shouldRun).toBe(true);
    expect(dec.kind).toBe('daily');
  });

  it('週間実行曜日を変更可能（土曜設定）', () => {
    // 2026-04-25 土 JST 22:00 = UTC 13:00
    const d = new Date('2026-04-25T13:00:00Z');
    const dec = decideSchedule(d, emptyState, { weeklyDayOfWeek: 6 });
    expect(dec.kind).toBe('weekly');
  });
});

// ============================================================================
// Cost tracking
// ============================================================================

describe('addCostEntry + createEmptyCostSummary', () => {
  it('空サマリ 0 件', () => {
    const s = createEmptyCostSummary();
    expect(s.totalCalls).toBe(0);
    expect(s.totalCost).toBe(0);
    expect(s.entries).toEqual([]);
  });

  it('daily エントリ追加で +30円', () => {
    const s = addCostEntry(createEmptyCostSummary(), { kind: 'daily', subject: 'math' });
    expect(s.totalCalls).toBe(1);
    expect(s.totalCost).toBe(DAILY_COST_ESTIMATE);
    expect(s.dailyCalls).toBe(1);
    expect(s.weeklyCalls).toBe(0);
  });

  it('weekly エントリ追加で +100円', () => {
    const s = addCostEntry(createEmptyCostSummary(), { kind: 'weekly' });
    expect(s.totalCost).toBe(WEEKLY_COST_ESTIMATE);
  });

  it('byMonth に月別集計される', () => {
    let s = createEmptyCostSummary();
    s = addCostEntry(s, { kind: 'daily', timestamp: '2026-04-01T20:00:00Z' });
    s = addCostEntry(s, { kind: 'daily', timestamp: '2026-04-15T20:00:00Z' });
    s = addCostEntry(s, { kind: 'weekly', timestamp: '2026-05-01T22:00:00Z' });
    expect(s.byMonth['2026-04']).toBe(60);
    expect(s.byMonth['2026-05']).toBe(100);
  });

  it('明示的 estimatedCost を使える', () => {
    const s = addCostEntry(createEmptyCostSummary(), {
      kind: 'daily',
      estimatedCost: 50,
    });
    expect(s.totalCost).toBe(50);
  });
});

describe('checkBudgetWarning', () => {
  it('予算内なら warning=false', () => {
    let s = createEmptyCostSummary();
    s = addCostEntry(s, { kind: 'daily', timestamp: '2026-04-01T20:00:00Z' });
    const result = checkBudgetWarning(s, '2026-04');
    expect(result.warning).toBe(false);
    expect(result.amount).toBe(30);
  });

  it('80% 超で warning=true', () => {
    let s = createEmptyCostSummary();
    // 1700円 = 85%
    for (let i = 0; i < 17; i++) {
      s = addCostEntry(s, { kind: 'weekly', timestamp: '2026-04-01T20:00:00Z' });
    }
    const result = checkBudgetWarning(s, '2026-04');
    expect(result.warning).toBe(true);
    expect(result.message).toMatch(/予算警告/);
  });

  it('100% 超で予算超過', () => {
    let s = createEmptyCostSummary();
    for (let i = 0; i < 25; i++) {
      s = addCostEntry(s, { kind: 'weekly', timestamp: '2026-04-01T20:00:00Z' });
    }
    const result = checkBudgetWarning(s, '2026-04');
    expect(result.warning).toBe(true);
    expect(result.message).toMatch(/予算超過/);
  });

  it('該当月にデータなしなら 0円扱い', () => {
    const s = createEmptyCostSummary();
    const result = checkBudgetWarning(s, '2030-01');
    expect(result.amount).toBe(0);
    expect(result.warning).toBe(false);
  });

  it('カスタム予算も使える', () => {
    let s = createEmptyCostSummary();
    s = addCostEntry(s, { kind: 'weekly', timestamp: '2026-04-01T20:00:00Z' });
    const result = checkBudgetWarning(s, '2026-04', 50);
    expect(result.warning).toBe(true);
    expect(result.percent).toBe(200);
  });
});

describe('budget constants', () => {
  it('MONTHLY_COST_BUDGET は 2000円', () => {
    expect(MONTHLY_COST_BUDGET).toBe(2000);
  });
});
