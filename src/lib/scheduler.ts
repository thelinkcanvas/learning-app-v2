/**
 * Scheduler Logic V2 - Pure scheduling decision functions
 *
 * ブラウザ・Node.js 共通で使える純粋関数のみ。
 * 実際の分析実行は client hook または batch script に委譲。
 *
 * 判定ロジック:
 * - Daily : 毎日 20:00（JST）、当日分析未実行なら trigger
 * - Weekly: 金曜 22:00（JST）、当週分析未実行なら trigger
 *
 * タイムゾーン: Asia/Tokyo 固定（日本の小学生向け）
 */

export type ScheduleKind = 'daily' | 'weekly' | 'none';

export interface SchedulerDecision {
  shouldRun: boolean;
  kind: ScheduleKind;
  reason: string;
  targetDate?: string;      // YYYY-MM-DD（daily 用）
  targetWeekStart?: string; // YYYY-MM-DD（weekly 用、月曜日）
}

export interface SchedulerState {
  /** 最終日次分析実行日（YYYY-MM-DD、JST） */
  lastDailyRunDate?: string;
  /** 最終週間分析実行日（YYYY-MM-DD、JST、金曜） */
  lastWeeklyRunDate?: string;
}

// ============================================================================
// Date utilities (JST 固定)
// ============================================================================

/**
 * Date を JST に変換して YYYY-MM-DD 形式で返す
 */
export function toJstDateString(d: Date): string {
  // UTC → JST の変換（+9時間）
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/**
 * Date の JST 時刻（0-23）を返す
 */
export function getJstHour(d: Date): number {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCHours();
}

/**
 * Date の JST 曜日を返す（0=日曜 〜 6=土曜）
 */
export function getJstDayOfWeek(d: Date): number {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCDay();
}

/**
 * 指定日付を含む週の月曜日を YYYY-MM-DD で返す（JST）
 */
export function getJstMondayOfWeek(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const day = jst.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // 月曜までの日数を戻す（Sun=6日前、Mon=0日前、Sat=5日前）
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(jst);
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return monday.toISOString().slice(0, 10);
}

// ============================================================================
// Scheduler Decision
// ============================================================================

export interface SchedulerOptions {
  /** 日次分析トリガー時刻（JST, 0-23）デフォルト 20 */
  dailyHour?: number;
  /** 週間分析トリガー時刻（JST, 0-23）デフォルト 22 */
  weeklyHour?: number;
  /** 週間分析トリガー曜日（0=日,1=月,...6=土）デフォルト 5（金） */
  weeklyDayOfWeek?: number;
}

const DEFAULT_OPTIONS: Required<SchedulerOptions> = {
  dailyHour: 20,
  weeklyHour: 22,
  weeklyDayOfWeek: 5, // Friday
};

/**
 * 現在時刻とスケジューラ状態から、実行すべきタスクを判定
 */
export function decideSchedule(
  now: Date,
  state: SchedulerState,
  options: SchedulerOptions = {}
): SchedulerDecision {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const todayJst = toJstDateString(now);
  const hourJst = getJstHour(now);
  const dayOfWeekJst = getJstDayOfWeek(now);

  // Weekly を先に判定（優先度高、複合実行になる場合もあるため）
  if (
    dayOfWeekJst === opts.weeklyDayOfWeek &&
    hourJst >= opts.weeklyHour &&
    state.lastWeeklyRunDate !== todayJst
  ) {
    return {
      shouldRun: true,
      kind: 'weekly',
      reason: `Friday ${opts.weeklyHour}:00+ JST, weekly analysis not yet run today`,
      targetDate: todayJst,
      targetWeekStart: getJstMondayOfWeek(now),
    };
  }

  // Daily 判定
  if (hourJst >= opts.dailyHour && state.lastDailyRunDate !== todayJst) {
    return {
      shouldRun: true,
      kind: 'daily',
      reason: `${opts.dailyHour}:00+ JST, daily analysis not yet run today`,
      targetDate: todayJst,
    };
  }

  return {
    shouldRun: false,
    kind: 'none',
    reason: buildNoneReason(hourJst, dayOfWeekJst, todayJst, state, opts),
  };
}

function buildNoneReason(
  hourJst: number,
  dayOfWeek: number,
  today: string,
  state: SchedulerState,
  opts: Required<SchedulerOptions>
): string {
  if (hourJst < opts.dailyHour) {
    return `before ${opts.dailyHour}:00 JST (current: ${hourJst}:00)`;
  }
  if (state.lastDailyRunDate === today && dayOfWeek !== opts.weeklyDayOfWeek) {
    return `daily already ran today (${today})`;
  }
  if (
    state.lastWeeklyRunDate === today &&
    state.lastDailyRunDate === today
  ) {
    return `both daily and weekly already ran today (${today})`;
  }
  return `no trigger condition met`;
}

// ============================================================================
// Cost Tracking
// ============================================================================

export interface GeminiCostEntry {
  timestamp: string;       // ISO 8601
  kind: 'daily' | 'weekly';
  subject?: string;
  estimatedCost: number;   // 日本円概算
  tokenEstimate?: number;
}

export interface GeminiCostSummary {
  totalCalls: number;
  totalCost: number;
  dailyCalls: number;
  weeklyCalls: number;
  byMonth: Record<string, number>; // YYYY-MM → 円
  entries: GeminiCostEntry[];
}

/** 日次分析あたりの推定コスト（円） */
export const DAILY_COST_ESTIMATE = 30;
/** 週間分析あたりの推定コスト（円） */
export const WEEKLY_COST_ESTIMATE = 100;
/** 月額警告閾値（円） */
export const MONTHLY_COST_BUDGET = 2000;

/**
 * コストエントリを追加してサマリを再計算
 */
export function addCostEntry(
  summary: GeminiCostSummary,
  entry: Omit<GeminiCostEntry, 'timestamp' | 'estimatedCost'> & {
    timestamp?: string;
    estimatedCost?: number;
  }
): GeminiCostSummary {
  const fullEntry: GeminiCostEntry = {
    timestamp: entry.timestamp ?? new Date().toISOString(),
    kind: entry.kind,
    subject: entry.subject,
    estimatedCost:
      entry.estimatedCost ??
      (entry.kind === 'daily' ? DAILY_COST_ESTIMATE : WEEKLY_COST_ESTIMATE),
    tokenEstimate: entry.tokenEstimate,
  };

  const entries = [...summary.entries, fullEntry];
  const totalCost = entries.reduce((sum, e) => sum + e.estimatedCost, 0);
  const byMonth: Record<string, number> = {};
  let dailyCalls = 0;
  let weeklyCalls = 0;

  for (const e of entries) {
    const month = e.timestamp.slice(0, 7);
    byMonth[month] = (byMonth[month] ?? 0) + e.estimatedCost;
    if (e.kind === 'daily') dailyCalls++;
    else weeklyCalls++;
  }

  return {
    totalCalls: entries.length,
    totalCost,
    dailyCalls,
    weeklyCalls,
    byMonth,
    entries,
  };
}

export function createEmptyCostSummary(): GeminiCostSummary {
  return {
    totalCalls: 0,
    totalCost: 0,
    dailyCalls: 0,
    weeklyCalls: 0,
    byMonth: {},
    entries: [],
  };
}

/**
 * 月次予算警告判定
 */
export function checkBudgetWarning(
  summary: GeminiCostSummary,
  month: string, // YYYY-MM
  budget = MONTHLY_COST_BUDGET
): { warning: boolean; percent: number; amount: number; message: string } {
  const amount = summary.byMonth[month] ?? 0;
  const percent = (amount / budget) * 100;
  if (percent >= 100) {
    return {
      warning: true,
      percent,
      amount,
      message: `⚠️ 予算超過: ${month} は ${amount}円 (budget: ${budget}円, ${percent.toFixed(0)}%)`,
    };
  }
  if (percent >= 80) {
    return {
      warning: true,
      percent,
      amount,
      message: `⚠️ 予算警告: ${month} は ${amount}円 (${percent.toFixed(0)}% of ${budget}円)`,
    };
  }
  return {
    warning: false,
    percent,
    amount,
    message: `OK: ${month} ${amount}円 (${percent.toFixed(0)}%)`,
  };
}
