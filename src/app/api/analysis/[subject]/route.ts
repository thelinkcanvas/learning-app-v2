/**
 * POST /api/analysis/[subject]
 *
 * 当日の会話ログを受け取り、Gemini 分析を実行して日次分析結果を返す。
 * 保存は client-side（localStorage）で行う方針のため、結果はレスポンスのみ。
 *
 * Request body:
 *   {
 *     messages: TimestampedMessage[],
 *     date: string (YYYY-MM-DD),
 *     options?: { skipGemini?: boolean, model?: string }
 *   }
 *
 * Response:
 *   {
 *     result: DailyAnalysisResult,
 *     geminiResponse: GeminiDailyAnalysisResponse | null,
 *     meta: { processingTimeMs: number }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { analyzeDailyWithGemini } from '@/lib/gemini-analysis';
import { TimestampedMessage } from '@/lib/types/analysis';

const VALID_SUBJECTS = ['math', 'japanese', 'science', 'social', 'english'];

interface DailyAnalysisRequestBody {
  messages: TimestampedMessage[];
  date: string;
  options?: {
    skipGemini?: boolean;
    model?: string;
  };
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date));
}

function isValidMessages(messages: unknown): messages is TimestampedMessage[] {
  if (!Array.isArray(messages)) return false;
  return messages.every(
    (m) =>
      m &&
      typeof m === 'object' &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      typeof m.timestamp === 'string'
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ subject: string }> }
) {
  const { subject } = await params;
  const startTime = Date.now();

  // 教科バリデーション
  if (!VALID_SUBJECTS.includes(subject)) {
    return NextResponse.json(
      {
        error: 'Invalid subject',
        allowed: VALID_SUBJECTS,
      },
      { status: 400 }
    );
  }

  // ボディパース
  let body: DailyAnalysisRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // 入力検証
  if (!isValidMessages(body.messages)) {
    return NextResponse.json(
      { error: 'messages must be TimestampedMessage[]' },
      { status: 400 }
    );
  }
  if (!body.date || !isValidDate(body.date)) {
    return NextResponse.json(
      { error: 'date must be YYYY-MM-DD' },
      { status: 400 }
    );
  }

  // 分析実行
  try {
    const { result, geminiResponse } = await analyzeDailyWithGemini(
      body.messages,
      subject,
      body.date,
      body.options ?? {}
    );

    return NextResponse.json({
      result,
      geminiResponse,
      meta: {
        processingTimeMs: Date.now() - startTime,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[api/analysis] daily analysis failed:', message);
    return NextResponse.json(
      {
        error: 'Analysis failed',
        detail: message,
      },
      { status: 500 }
    );
  }
}
