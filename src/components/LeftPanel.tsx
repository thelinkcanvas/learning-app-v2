'use client';

import { useState, useEffect } from 'react';
import ImagePane from './ImagePane';
import { AnalysisPanel } from './AnalysisPanel';
import { loadDailyAnalysis } from '@/lib/storage';
import { toJstDateString } from '@/lib/scheduler';
import { DailyAnalysisResult } from '@/lib/types/analysis';

interface LeftPanelProps {
  subject: string;
}

/**
 * LeftPanel - 左パネルの動的切り替え
 *
 * - 分析データあり → AnalysisPanel（解析結果）
 * - 分析データなし → ImagePane（ヒント画像）
 */
export default function LeftPanel({ subject }: LeftPanelProps) {
  const [analysisResult, setAnalysisResult] = useState<DailyAnalysisResult | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  useEffect(() => {
    const checkAnalysis = () => {
      const today = toJstDateString(new Date());
      const result = loadDailyAnalysis(subject, today);
      if (result) {
        setAnalysisResult(result);
      }
    };

    checkAnalysis();
    // 30秒ごとに分析データを確認
    const interval = setInterval(checkAnalysis, 30000);
    return () => clearInterval(interval);
  }, [subject]);

  return (
    <div className="flex flex-col h-full">
      {/* タブ切り替えヘッダー */}
      {analysisResult && (
        <div className="flex border-b border-gray-200 bg-white">
          <button
            onClick={() => setShowAnalysis(false)}
            className={`flex-1 py-2 text-sm font-medium transition ${
              !showAnalysis
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            📖 ヒント
          </button>
          <button
            onClick={() => setShowAnalysis(true)}
            className={`flex-1 py-2 text-sm font-medium transition ${
              showAnalysis
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            📊 分析結果
          </button>
        </div>
      )}

      {/* コンテンツ */}
      <div className="flex-1 overflow-hidden">
        {showAnalysis && analysisResult ? (
          <div className="h-full overflow-y-auto">
            <AnalysisPanel result={analysisResult} />
          </div>
        ) : (
          <ImagePane subject={subject} />
        )}
      </div>
    </div>
  );
}
