/**
 * POST /api/analysis/report/weekly
 *
 * 7日分の日次分析結果を受け取り、Gemini で週間レポート（親向けガイダンス含む）を生成。
 * dailyResults は client から送信される（localStorage に保存されているため）。
 *
 * Request body:
 *   {
 *     dailyResults: DailyAnalysisResult[],
 *     weekLabel: string (例: "2026-04-13〜2026-04-19"),
 *     options?: { model?: string }
 *   }
 *
 * Response:
 *   {
 *     result: WeeklyReportData,
 *     geminiResponse: GeminiWeeklyAnalysisResponse | null,
 *     meta: { processingTimeMs: number, daysProcessed: number }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { analyzeWeeklyWithGemini } from '@/lib/gemini-analysis';
import { DailyAnalysisResult } from '@/lib/types/analysis';

interface WeeklyReportRequestBody {
  dailyResults: DailyAnalysisResult[];
  weekLabel: string;
  options?: { model?: string };
}

function isValidDailyResult(r: unknown): r is DailyAnalysisResult {
  return (
    !!r &&
    typeof r === 'object' &&
    typeof (r as DailyAnalysisResult).date === 'string' &&
    typeof (r as DailyAnalysisResult).subject === 'string' &&
    Array.isArray((r as DailyAnalysisResult).patterns) &&
    typeof (r as DailyAnalysisResult).masteryByUnit === 'object'
  );
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  let body: WeeklyReportRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.dailyResults) || body.dailyResults.length === 0) {
    return NextResponse.json(
      { error: 'dailyResults must be non-empty array' },
      { status: 400 }
    );
  }
  if (!body.dailyResults.every(isValidDailyResult)) {
    return NextResponse.json(
      { error: 'dailyResults contains invalid entries' },
      { status: 400 }
    );
  }
  if (typeof body.weekLabel !== 'string' || body.weekLabel.length === 0) {
    return NextResponse.json(
      { error: 'weekLabel required' },
      { status: 400 }
    );
  }
  if (body.dailyResults.length > 14) {
    return NextResponse.json(
      { error: 'dailyResults must not exceed 14 days' },
      { status: 400 }
    );
  }

  try {
    const { result, geminiResponse } = await analyzeWeeklyWithGemini(
      body.dailyResults,
      body.weekLabel,
      body.options ?? {}
    );

    return NextResponse.json({
      result,
      geminiResponse,
      meta: {
        processingTimeMs: Date.now() - startTime,
        daysProcessed: body.dailyResults.length,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[api/analysis/weekly] failed:', message);
    return NextResponse.json(
      { error: 'Weekly analysis failed', detail: message },
      { status: 500 }
    );
  }
}
