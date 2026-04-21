#!/usr/bin/env tsx
/**
 * Batch Analysis Script - Node.js orchestrator
 *
 * localStorage が使えない環境向けの CLI 実行ツール。
 * ファイルベースで会話ログを読み、分析結果を JSON として保存する。
 *
 * 用途:
 * - 開発・デバッグ（ローカル実行）
 * - CI / 回帰テスト（historical batch）
 * - データ回復（過去日時の再分析）
 * - Cron 実行（Vercel Cron, GitHub Actions 等）
 *
 * Usage:
 *   tsx scripts/batch-analysis.ts daily --subject=math --date=2026-04-22
 *   tsx scripts/batch-analysis.ts weekly --week-start=2026-04-20
 *   tsx scripts/batch-analysis.ts cost --month=2026-04
 *
 * Data layout:
 *   data/
 *     conversations/{subject}_{date}.json
 *     analysis/{subject}_{date}.json
 *     weekly/{weekStart}.json
 *     cost-summary.json
 */

import fs from 'fs';
import path from 'path';
import { analyzeDailyWithGemini, analyzeWeeklyWithGemini } from '../src/lib/gemini-analysis';
import {
  DailyAnalysisResult,
  TimestampedMessage,
  WeeklyReportData,
} from '../src/lib/types/analysis';
import {
  addCostEntry,
  createEmptyCostSummary,
  GeminiCostSummary,
  checkBudgetWarning,
  getJstMondayOfWeek,
  toJstDateString,
  MONTHLY_COST_BUDGET,
} from '../src/lib/scheduler';

// ============================================================================
// Paths
// ============================================================================

const DATA_DIR = path.join(process.cwd(), 'data');
const CONV_DIR = path.join(DATA_DIR, 'conversations');
const ANALYSIS_DIR = path.join(DATA_DIR, 'analysis');
const WEEKLY_DIR = path.join(DATA_DIR, 'weekly');
const COST_FILE = path.join(DATA_DIR, 'cost-summary.json');

function ensureDirs() {
  [DATA_DIR, CONV_DIR, ANALYSIS_DIR, WEEKLY_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ============================================================================
// Utilities
// ============================================================================

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  success: (msg: string) => void;
};

function createLogger(): Logger {
  const color = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
  };
  return {
    info: (m) => console.log(`${color.cyan}[INFO]${color.reset} ${m}`),
    warn: (m) => console.log(`${color.yellow}[WARN]${color.reset} ${m}`),
    error: (m) => console.error(`${color.red}[ERROR]${color.reset} ${m}`),
    success: (m) => console.log(`${color.green}[OK]${color.reset} ${m}`),
  };
}

const log = createLogger();

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch (e) {
    log.error(`read failed: ${p}: ${e}`);
    return null;
  }
}

function writeJson(p: string, data: unknown): boolean {
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    log.error(`write failed: ${p}: ${e}`);
    return false;
  }
}

function loadCostSummary(): GeminiCostSummary {
  return readJson<GeminiCostSummary>(COST_FILE) ?? createEmptyCostSummary();
}

function saveCostSummary(summary: GeminiCostSummary): void {
  writeJson(COST_FILE, summary);
}

// ============================================================================
// Arg parsing
// ============================================================================

interface ParsedArgs {
  _: string[];
  [key: string]: string | boolean | string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        args[a.slice(2)] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// ============================================================================
// Commands
// ============================================================================

async function cmdDaily(args: ParsedArgs): Promise<number> {
  const subject = String(args.subject ?? '');
  const date = String(args.date ?? toJstDateString(new Date()));

  if (!subject) {
    log.error('--subject required (math, japanese, science, social, english)');
    return 2;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    log.error('--date must be YYYY-MM-DD');
    return 2;
  }

  const convPath = path.join(CONV_DIR, `${subject}_${date}.json`);
  const messages = readJson<TimestampedMessage[]>(convPath);

  if (!messages || messages.length === 0) {
    log.warn(`No conversation data at ${convPath}`);
    return 3;
  }

  log.info(`Running daily analysis: subject=${subject} date=${date} messages=${messages.length}`);

  try {
    const { result, geminiResponse } = await analyzeDailyWithGemini(
      messages,
      subject,
      date
    );

    const outPath = path.join(ANALYSIS_DIR, `${subject}_${date}.json`);
    writeJson(outPath, result);
    log.success(`Saved analysis to ${outPath}`);

    if (geminiResponse) {
      log.info(`Gemini enriched: ${result.recommendedActions.length} recommendations`);
      recordCost('daily', subject);
    } else {
      log.info(`Heuristic-only (Gemini skipped or failed)`);
    }
    log.info(`Patterns detected: ${result.patterns.length}`);
    return 0;
  } catch (e) {
    log.error(`Daily analysis failed: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
}

async function cmdWeekly(args: ParsedArgs): Promise<number> {
  let weekStart = String(args['week-start'] ?? '');
  if (!weekStart) {
    weekStart = getJstMondayOfWeek(new Date());
    log.info(`--week-start not specified, using current week: ${weekStart}`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    log.error('--week-start must be YYYY-MM-DD');
    return 2;
  }

  // 週開始から 7 日分の daily analysis を集める
  const dailyResults: DailyAnalysisResult[] = [];
  const startDate = new Date(weekStart);
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);

    // 全教科スキャン
    if (!fs.existsSync(ANALYSIS_DIR)) continue;
    const files = fs.readdirSync(ANALYSIS_DIR);
    for (const f of files) {
      if (f.endsWith(`_${dateStr}.json`)) {
        const r = readJson<DailyAnalysisResult>(path.join(ANALYSIS_DIR, f));
        if (r) dailyResults.push(r);
      }
    }
  }

  if (dailyResults.length === 0) {
    log.warn(`No daily analysis found in week starting ${weekStart}`);
    return 3;
  }

  const sunday = new Date(startDate);
  sunday.setDate(sunday.getDate() + 6);
  const weekEnd = sunday.toISOString().slice(0, 10);
  const weekLabel = `${weekStart}〜${weekEnd}`;

  log.info(`Running weekly analysis: ${weekLabel} (${dailyResults.length} daily results)`);

  try {
    const { result } = await analyzeWeeklyWithGemini(dailyResults, weekLabel);
    const outPath = path.join(WEEKLY_DIR, `${weekStart}.json`);
    writeJson(outPath, result);
    log.success(`Saved weekly report to ${outPath}`);
    log.info(`Subjects analyzed: ${Object.keys(result.subjects).join(', ')}`);
    recordCost('weekly');
    return 0;
  } catch (e) {
    log.error(`Weekly analysis failed: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
}

function cmdCost(args: ParsedArgs): number {
  const month = String(args.month ?? new Date().toISOString().slice(0, 7));
  const summary = loadCostSummary();
  const result = checkBudgetWarning(summary, month);

  console.log('');
  console.log('=== Gemini API Cost Summary ===');
  console.log(`Total calls:   ${summary.totalCalls}`);
  console.log(`  daily:       ${summary.dailyCalls}`);
  console.log(`  weekly:      ${summary.weeklyCalls}`);
  console.log(`Total cost:    ¥${summary.totalCost.toLocaleString()}`);
  console.log('');
  console.log(`[${month}] ¥${result.amount.toLocaleString()} / ¥${MONTHLY_COST_BUDGET.toLocaleString()} (${result.percent.toFixed(1)}%)`);
  console.log(result.message);
  console.log('');

  if (Object.keys(summary.byMonth).length > 0) {
    console.log('Monthly breakdown:');
    const sorted = Object.entries(summary.byMonth).sort();
    for (const [m, v] of sorted) {
      console.log(`  ${m}: ¥${v.toLocaleString()}`);
    }
  }

  return result.warning ? 1 : 0;
}

function cmdHelp(): number {
  console.log(`
Batch Analysis Script - V2

Commands:
  daily     Run daily pattern analysis for a subject
              --subject=math|japanese|science|social|english (required)
              --date=YYYY-MM-DD (default: today)

  weekly    Run weekly aggregate analysis
              --week-start=YYYY-MM-DD (default: current Monday)

  cost      Show Gemini API cost summary
              --month=YYYY-MM (default: current month)

  help      Show this help

Data layout (relative to cwd):
  data/conversations/{subject}_{date}.json   (input: TimestampedMessage[])
  data/analysis/{subject}_{date}.json        (output: DailyAnalysisResult)
  data/weekly/{weekStart}.json               (output: WeeklyReportData)
  data/cost-summary.json                     (running cost total)

Environment:
  NEXT_PUBLIC_GEMINI_API_KEY   Gemini API key (required for Gemini enrichment)

Examples:
  tsx scripts/batch-analysis.ts daily --subject=math
  tsx scripts/batch-analysis.ts daily --subject=math --date=2026-04-20
  tsx scripts/batch-analysis.ts weekly --week-start=2026-04-20
  tsx scripts/batch-analysis.ts cost --month=2026-04
`);
  return 0;
}

function recordCost(kind: 'daily' | 'weekly', subject?: string) {
  const summary = loadCostSummary();
  const updated = addCostEntry(summary, { kind, subject });
  saveCostSummary(updated);

  // 予算警告
  const month = new Date().toISOString().slice(0, 7);
  const check = checkBudgetWarning(updated, month);
  if (check.warning) {
    log.warn(check.message);
  } else {
    log.info(check.message);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<number> {
  ensureDirs();

  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  switch (cmd) {
    case 'daily':
      return cmdDaily(args);
    case 'weekly':
      return cmdWeekly(args);
    case 'cost':
      return cmdCost(args);
    case 'help':
    case undefined:
      return cmdHelp();
    default:
      log.error(`Unknown command: ${cmd}`);
      cmdHelp();
      return 2;
  }
}

// Entry point guard（test import 時は実行しない）
if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      log.error(`Fatal: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    });
}

// Export for testing
export { parseArgs, cmdCost, cmdHelp };
