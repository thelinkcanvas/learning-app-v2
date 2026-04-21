/**
 * ParentReportPanel - 親向けの週間レポート表示
 *
 * 実行可能なガイダンス・成功率トレンド・単元別進度を表示
 * Chromebook 1280×800 に最適化（グラフは簡易SVG）
 */

import { WeeklyReportData } from '@/lib/types/analysis';

interface ParentReportPanelProps {
  report: WeeklyReportData;
  parentName?: string;
}

/**
 * 簡易バーグラフ（SVG）
 * 単元別の成功率を視覚化
 */
function SimpleProgressBar({
  subject,
  successRateChange,
  topicCount,
}: {
  subject: string;
  successRateChange: string;
  topicCount: number;
}) {
  const match = successRateChange.match(/([+-]?)(\d+)%/);
  const changeNum = match ? parseInt(match[2]) * (match[1] === '-' ? -1 : 1) : 0;
  // 0% = 0px, 100% = 120px の棒グラフ
  const barWidth = Math.max(0, Math.min(120, 60 + changeNum * 1.2));
  const barColor = changeNum > 0 ? '#10b981' : changeNum < 0 ? '#ef4444' : '#6b7280';

  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-semibold text-gray-700">{subject}</span>
        <span
          className={`text-sm font-bold ${
            changeNum > 0
              ? 'text-green-600'
              : changeNum < 0
                ? 'text-red-600'
                : 'text-gray-600'
          }`}
        >
          {successRateChange}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded h-2 relative">
        <div
          style={{ width: `${barWidth}px`, backgroundColor: barColor }}
          className="h-full rounded transition-all duration-300"
        />
      </div>
      <span className="text-xs text-gray-500">{topicCount} 単元を学習中</span>
    </div>
  );
}

export function ParentReportPanel({ report, parentName = '保護者様' }: ParentReportPanelProps) {
  const subjects = Object.values(report.subjects);
  const guidance = report.parentGuidance;
  const strengths = report.subjects[Object.keys(report.subjects)[0]]?.recommendations || [];

  return (
    <div className="w-full space-y-6 p-6 bg-white">
      {/* Header */}
      <div className="border-b-2 border-blue-200 pb-4">
        <h1 className="text-3xl font-bold text-blue-900 mb-2">
          📊 週間学習レポート
        </h1>
        <p className="text-gray-600">{report.week}</p>
      </div>

      {/* Overall Assessment */}
      <div className="bg-blue-50 rounded-lg p-4 border-l-4 border-blue-400">
        <h2 className="text-lg font-semibold text-blue-900 mb-2">
          🌱 今週の成長評価
        </h2>
        <p className="text-gray-800 leading-relaxed">
          {report.overallGrowthAssessment}
        </p>
      </div>

      {/* Success Rate Trends */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border-l-4 border-green-400">
        <h2 className="text-lg font-semibold text-green-900 mb-4">
          📈 教科別進捗
        </h2>
        <div>
          {subjects.map((subject) => (
            <SimpleProgressBar
              key={subject.subject}
              subject={subject.subject}
              successRateChange={subject.successRateChange}
              topicCount={Object.keys(subject.topicPerformance).length}
            />
          ))}
        </div>
      </div>

      {/* Parent Guidance - 実行形 */}
      <div className="bg-amber-50 rounded-lg p-4 border-l-4 border-amber-400">
        <h2 className="text-lg font-semibold text-amber-900 mb-4">
          👨‍👩‍👧 この週末、一緒にやってみよう
        </h2>

        <div className="space-y-4">
          {/* What to Focus */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">
              🎯 重点分野
            </h3>
            <p className="text-gray-800 bg-white rounded p-2 text-sm">
              {guidance.whatToFocus}
            </p>
          </div>

          {/* How to Support */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">
              💪 親の関わり方
            </h3>
            <p className="text-gray-800 bg-white rounded p-2 text-sm leading-relaxed">
              {guidance.howToSupport}
            </p>
          </div>

          {/* Timeline */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">
              📅 習得までの目安
            </h3>
            <p className="text-gray-800 bg-white rounded p-2 text-sm font-semibold">
              {guidance.timelineToMastery}
            </p>
          </div>

          {/* Concrete Resources */}
          {guidance.concreteResources && guidance.concreteResources.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                🛠 推奨リソース
              </h3>
              <ul className="space-y-1">
                {guidance.concreteResources.slice(0, 5).map((resource, i) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-blue-500">→</span>
                    <span>{resource}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Strengths Observed */}
      {strengths.length > 0 && (
        <div className="bg-purple-50 rounded-lg p-4 border-l-4 border-purple-400">
          <h2 className="text-lg font-semibold text-purple-900 mb-3">
            ⭐ 今週の成長ポイント
          </h2>
          <ul className="space-y-2">
            {strengths.slice(0, 3).map((strength, i) => (
              <li
                key={i}
                className="text-sm text-gray-800 flex items-start gap-2 bg-white rounded p-2"
              >
                <span className="text-yellow-500 text-lg">✨</span>
                <span>{strength}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Items - Copy Friendly */}
      <div className="bg-gray-50 rounded-lg p-4 border border-dashed border-gray-300">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          📋 週末スケジュール（コピーして使ってね）
        </h3>
        <div className="bg-white rounded p-3 font-mono text-xs text-gray-700 whitespace-pre-wrap break-words border border-gray-200">
          {`【土曜】
${guidance.howToSupport}

【日曜】
復習タイム：上記の内容を繰り返す

【注目ポイント】
- お子さんの回答を褒める（才能ではなく、努力を褒める）
- 「教えて」と言ったら、惜しみなくヒントを与える
- 15分程度が目安。疲れたら無理しない`}
        </div>
      </div>

      {/* Next Unit */}
      {guidance.estimatedNextUnit && (
        <div className="bg-indigo-50 rounded-lg p-4 border-l-4 border-indigo-400">
          <h3 className="text-sm font-semibold text-indigo-900 mb-1">
            🚀 次に進む予定の単元
          </h3>
          <p className="text-gray-800 text-sm">{guidance.estimatedNextUnit}</p>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-gray-200 pt-4 text-xs text-gray-500">
        <p>
          📝 このレポートは AI が自動生成したものです。お子さんの学習データを基に、
          個別化されたガイダンスを提案しています。
        </p>
        <p className="mt-2">
          ご質問や気になることがあれば、学習画面でお子さんと一緒に確認してください。
        </p>
        <p className="mt-4 text-right">
          生成時刻: {new Date(report.generatedAt).toLocaleString('ja-JP')}
        </p>
      </div>
    </div>
  );
}
