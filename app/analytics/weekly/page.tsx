'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadDailyAnalysisRange } from '@/lib/storage';
import { toJstDateString } from '@/lib/scheduler';
import { DailyAnalysisResult } from '@/lib/types/analysis';

const subjects = [
  { id: 'math', name: '算数', emoji: '🔢', color: 'bg-blue-100', barColor: 'bg-blue-500' },
  { id: 'japanese', name: '国語', emoji: '📖', color: 'bg-red-100', barColor: 'bg-red-500' },
  { id: 'science', name: '理科', emoji: '🔬', color: 'bg-green-100', barColor: 'bg-green-500' },
  { id: 'social', name: '社会', emoji: '🌍', color: 'bg-yellow-100', barColor: 'bg-yellow-500' },
];

interface SubjectStats {
  totalSessions: number;
  successRate: number;
  latestPatterns: string[];
  trend: 'up' | 'down' | 'flat';
}

function calcStats(results: DailyAnalysisResult[]): SubjectStats {
  if (results.length === 0) {
    return { totalSessions: 0, successRate: 0, latestPatterns: [], trend: 'flat' };
  }

  const totalMessages = results.reduce((sum, r) => sum + r.messageCount, 0);
  const successCount = results.reduce((sum, r) => {
    const hasSuccess = r.patterns.some((p) => p.type === 'failure-success' || p.type === 'mastery');
    return sum + (hasSuccess ? 1 : 0);
  }, 0);
  const successRate = results.length > 0 ? Math.round((successCount / results.length) * 100) : 0;

  const latest = results[results.length - 1];
  const latestPatterns = latest?.patterns.slice(0, 2).map((p) => {
    switch (p.type) {
      case 'repetition': return '繰り返し学習';
      case 'failure-success': return '成功体験あり';
      case 'mastery': return '得意分野伸長';
      case 'confidence-decline': return '集中力低下';
      case 'hint-dependency': return 'ヒント活用';
      case 'fluency': return '流暢に理解';
      default: return p.type;
    }
  }) ?? [];

  // 直近2日の比較でトレンド判定
  let trend: 'up' | 'down' | 'flat' = 'flat';
  if (results.length >= 2) {
    const prev = results[results.length - 2];
    const curr = results[results.length - 1];
    const prevSuccess = prev.patterns.some((p) => p.type === 'failure-success' || p.type === 'mastery');
    const currSuccess = curr.patterns.some((p) => p.type === 'failure-success' || p.type === 'mastery');
    if (currSuccess && !prevSuccess) trend = 'up';
    else if (!currSuccess && prevSuccess) trend = 'down';
  }

  return { totalSessions: results.length, successRate, latestPatterns, trend };
}

export default function WeeklyAnalyticsPage() {
  const [stats, setStats] = useState<Record<string, SubjectStats>>({});
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });

  useEffect(() => {
    const today = new Date();
    const toDate = toJstDateString(today);
    const fromDate = toJstDateString(new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000));
    setDateRange({ from: fromDate, to: toDate });

    const newStats: Record<string, SubjectStats> = {};
    for (const subject of subjects) {
      const results = loadDailyAnalysisRange(subject.id, fromDate, toDate);
      newStats[subject.id] = calcStats(results);
    }
    setStats(newStats);
    setLoading(false);
  }, []);

  const trendIcon = (trend: 'up' | 'down' | 'flat') => {
    if (trend === 'up') return '↑';
    if (trend === 'down') return '↓';
    return '→';
  };

  const trendColor = (trend: 'up' | 'down' | 'flat') => {
    if (trend === 'up') return 'text-green-600';
    if (trend === 'down') return 'text-red-500';
    return 'text-gray-500';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-100 p-6 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/"
            className="text-gray-600 hover:text-gray-900 font-medium px-3 py-2 hover:bg-white rounded transition"
          >
            ← 戻る
          </Link>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-gray-800">📊 今週の分析結果</h1>
            {dateRange.from && (
              <p className="text-sm text-gray-500 mt-1">
                {dateRange.from} 〜 {dateRange.to}
              </p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-500">読み込み中...</div>
        ) : (
          <div className="space-y-4">
            {subjects.map((subject) => {
              const s = stats[subject.id] ?? { totalSessions: 0, successRate: 0, latestPatterns: [], trend: 'flat' as const };
              const hasData = s.totalSessions > 0;

              return (
                <div key={subject.id} className={`${subject.color} rounded-xl p-5 md:p-6 shadow-md`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-3xl">{subject.emoji}</span>
                      <span className="text-xl font-bold text-gray-800">{subject.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasData && (
                        <span className={`text-xl font-bold ${trendColor(s.trend)}`}>
                          {trendIcon(s.trend)}
                        </span>
                      )}
                      <span className="text-2xl font-bold text-gray-800">
                        {hasData ? `${s.successRate}%` : '---'}
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-white bg-opacity-60 rounded-full h-3 mb-3">
                    <div
                      className={`${subject.barColor} h-3 rounded-full transition-all duration-500`}
                      style={{ width: hasData ? `${s.successRate}%` : '0%' }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>
                      {hasData ? `${s.totalSessions}日間のデータ` : 'まだデータがありません'}
                    </span>
                    {s.latestPatterns.length > 0 && (
                      <div className="flex gap-1">
                        {s.latestPatterns.map((p, i) => (
                          <span key={i} className="bg-white bg-opacity-70 px-2 py-0.5 rounded-full text-xs">
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Summary */}
            <div className="bg-white rounded-xl p-5 shadow-md text-center">
              <p className="text-gray-600 text-sm">
                分析データは毎日 20:00 に自動更新されます
              </p>
              <p className="text-gray-500 text-xs mt-1">
                まだデータがない教科は学習を始めてみよう！
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
