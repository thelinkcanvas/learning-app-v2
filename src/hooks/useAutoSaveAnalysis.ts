/**
 * useAutoSaveAnalysis - Client-side analysis scheduler hook
 *
 * ブラウザが開いている間、定期的にスケジューラを確認し、
 * 20:00 / 金曜 22:00 で分析をトリガーする。
 *
 * 挙動:
 * - 1 分おきに decideSchedule() を呼ぶ
 * - 条件合致時、API /api/analysis/[subject] または /report/weekly を叩く
 * - 結果を localStorage に保存
 * - 実行履歴を cost summary に記録
 *
 * 使い方:
 * ```
 * const { lastRun, costSummary, runNow } = useAutoSaveAnalysis({
 *   subjects: ['math', 'japanese'],
 *   enabled: true,
 * });
 * ```
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  decideSchedule,
  SchedulerState,
  SchedulerDecision,
  SchedulerOptions,
  GeminiCostSummary,
  createEmptyCostSummary,
  addCostEntry,
  toJstDateString,
} from '@/lib/scheduler';
import {
  loadConversationAsTimestamped,
  saveDailyAnalysis,
  loadDailyAnalysisRange,
  saveWeeklyReport,
  loadDailyAnalysis,
} from '@/lib/storage';
import {
  DailyAnalysisResult,
  WeeklyReportData,
  TimestampedMessage,
} from '@/lib/types/analysis';

// ============================================================================
// Types
// ============================================================================

export interface UseAutoSaveAnalysisOptions extends SchedulerOptions {
  /** 対象教科（会話ログから各教科の分析を実行） */
  subjects: string[];
  /** 有効・無効フラグ */
  enabled?: boolean;
  /** スケジューラのチェック間隔（ミリ秒）デフォルト 60000 */
  checkIntervalMs?: number;
  /** エラー時のコールバック */
  onError?: (kind: 'daily' | 'weekly', error: Error) => void;
  /** 実行完了時のコールバック */
  onSuccess?: (kind: 'daily' | 'weekly', result: unknown) => void;
}

export interface UseAutoSaveAnalysisState {
  /** 最終実行情報 */
  lastRun: {
    kind: 'daily' | 'weekly';
    at: string;
    success: boolean;
    error?: string;
  } | null;
  /** 実行履歴 */
  costSummary: GeminiCostSummary;
  /** 次のスケジュール判定 */
  nextDecision: SchedulerDecision | null;
  /** 手動実行 */
  runNow: (kind: 'daily' | 'weekly') => Promise<void>;
  /** 実行中フラグ */
  isRunning: boolean;
}

// ============================================================================
// Storage keys for hook internal state
// ============================================================================

const HOOK_STATE_KEY = 'auto_save_analysis_state';
const COST_SUMMARY_KEY = 'gemini_cost_summary';

interface PersistedHookState {
  schedulerState: SchedulerState;
}

function loadPersistedState(): PersistedHookState {
  if (typeof window === 'undefined') return { schedulerState: {} };
  try {
    const raw = localStorage.getItem(HOOK_STATE_KEY);
    if (!raw) return { schedulerState: {} };
    return JSON.parse(raw);
  } catch {
    return { schedulerState: {} };
  }
}

function savePersistedState(state: PersistedHookState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HOOK_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('[useAutoSaveAnalysis] failed to persist state:', e);
  }
}

function loadCostSummary(): GeminiCostSummary {
  if (typeof window === 'undefined') return createEmptyCostSummary();
  try {
    const raw = localStorage.getItem(COST_SUMMARY_KEY);
    if (!raw) return createEmptyCostSummary();
    return JSON.parse(raw) as GeminiCostSummary;
  } catch {
    return createEmptyCostSummary();
  }
}

function saveCostSummary(summary: GeminiCostSummary): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(COST_SUMMARY_KEY, JSON.stringify(summary));
  } catch (e) {
    console.error('[useAutoSaveAnalysis] failed to save cost:', e);
  }
}

// ============================================================================
// Analysis execution
// ============================================================================

/**
 * 日次分析 API を叩いて結果を localStorage に保存
 */
async function runDailyForSubject(
  subject: string,
  date: string
): Promise<DailyAnalysisResult | null> {
  const messages = loadConversationAsTimestamped(subject, date);
  if (messages.length < 4) {
    // 会話が少ない場合はスキップ
    return null;
  }

  const response = await fetch(`/api/analysis/${subject}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      date,
    }),
  });

  if (!response.ok) {
    throw new Error(`Daily analysis API ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const result = data.result as DailyAnalysisResult;
  saveDailyAnalysis(result);
  return result;
}

/**
 * 週間分析 API を叩く（過去 7 日分の dailyResults を送る）
 */
async function runWeeklyAnalysis(
  weekStart: string,
  weekEnd: string
): Promise<WeeklyReportData | null> {
  const dailyResults = loadDailyAnalysisRange(null, weekStart, weekEnd);
  if (dailyResults.length === 0) return null;

  const weekLabel = `${weekStart}〜${weekEnd}`;
  const response = await fetch(`/api/analysis/report/weekly`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dailyResults,
      weekLabel,
    }),
  });

  if (!response.ok) {
    throw new Error(`Weekly analysis API ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const result = data.result as WeeklyReportData;
  saveWeeklyReport(weekStart, result);
  return result;
}

// ============================================================================
// Hook
// ============================================================================

export function useAutoSaveAnalysis(
  options: UseAutoSaveAnalysisOptions
): UseAutoSaveAnalysisState {
  const {
    subjects,
    enabled = true,
    checkIntervalMs = 60_000,
    onError,
    onSuccess,
    ...schedulerOpts
  } = options;

  const [lastRun, setLastRun] = useState<UseAutoSaveAnalysisState['lastRun']>(null);
  const [costSummary, setCostSummary] = useState<GeminiCostSummary>(loadCostSummary);
  const [nextDecision, setNextDecision] = useState<SchedulerDecision | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const persistedStateRef = useRef<PersistedHookState>(loadPersistedState());
  const isRunningRef = useRef(false);

  // 実行ハンドラ
  const executeDaily = useCallback(
    async (date: string) => {
      const results: DailyAnalysisResult[] = [];
      for (const subject of subjects) {
        const r = await runDailyForSubject(subject, date);
        if (r) {
          results.push(r);
          setCostSummary((prev) => {
            const updated = addCostEntry(prev, { kind: 'daily', subject });
            saveCostSummary(updated);
            return updated;
          });
        }
      }
      return results;
    },
    [subjects]
  );

  const executeWeekly = useCallback(async (weekStart: string, targetDate: string) => {
    // 週末（土曜日まで）を含むよう end 日付を計算
    const mondayDate = new Date(weekStart);
    const sunday = new Date(mondayDate);
    sunday.setDate(sunday.getDate() + 6);
    const weekEnd = sunday.toISOString().slice(0, 10);

    const report = await runWeeklyAnalysis(weekStart, weekEnd);
    if (report) {
      setCostSummary((prev) => {
        const updated = addCostEntry(prev, { kind: 'weekly' });
        saveCostSummary(updated);
        return updated;
      });
    }
    return { report, targetDate };
  }, []);

  const runNow = useCallback(
    async (kind: 'daily' | 'weekly') => {
      if (isRunningRef.current) {
        console.warn('[useAutoSaveAnalysis] already running, skip');
        return;
      }
      isRunningRef.current = true;
      setIsRunning(true);

      try {
        const now = new Date();
        const today = toJstDateString(now);

        if (kind === 'daily') {
          const results = await executeDaily(today);
          persistedStateRef.current.schedulerState.lastDailyRunDate = today;
          savePersistedState(persistedStateRef.current);
          setLastRun({ kind: 'daily', at: now.toISOString(), success: true });
          onSuccess?.('daily', results);
        } else {
          const dec = decideSchedule(now, persistedStateRef.current.schedulerState, schedulerOpts);
          const weekStart =
            dec.targetWeekStart ??
            (() => {
              const d = new Date(now);
              const day = d.getDay();
              const diff = day === 0 ? 6 : day - 1;
              d.setDate(d.getDate() - diff);
              return d.toISOString().slice(0, 10);
            })();
          const result = await executeWeekly(weekStart, today);
          persistedStateRef.current.schedulerState.lastWeeklyRunDate = today;
          savePersistedState(persistedStateRef.current);
          setLastRun({ kind: 'weekly', at: now.toISOString(), success: true });
          onSuccess?.('weekly', result);
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setLastRun({
          kind,
          at: new Date().toISOString(),
          success: false,
          error: err.message,
        });
        onError?.(kind, err);
      } finally {
        isRunningRef.current = false;
        setIsRunning(false);
      }
    },
    [executeDaily, executeWeekly, onError, onSuccess, schedulerOpts]
  );

  // スケジューラチェック
  useEffect(() => {
    if (!enabled) return;

    const check = async () => {
      const now = new Date();
      const decision = decideSchedule(
        now,
        persistedStateRef.current.schedulerState,
        schedulerOpts
      );
      setNextDecision(decision);

      if (decision.shouldRun && !isRunningRef.current) {
        await runNow(decision.kind as 'daily' | 'weekly');
      }
    };

    // 初回即チェック
    check();
    const intervalId = setInterval(check, checkIntervalMs);
    return () => clearInterval(intervalId);
  }, [enabled, checkIntervalMs, runNow, schedulerOpts]);

  return {
    lastRun,
    costSummary,
    nextDecision,
    runNow,
    isRunning,
  };
}

/**
 * 指定日の日次分析結果を取得するユーティリティ（UI 用）
 */
export function useDailyAnalysis(
  subject: string,
  date: string
): DailyAnalysisResult | null {
  const [result, setResult] = useState<DailyAnalysisResult | null>(null);

  useEffect(() => {
    setResult(loadDailyAnalysis(subject, date));
  }, [subject, date]);

  return result;
}
