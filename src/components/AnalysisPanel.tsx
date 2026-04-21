/**
 * AnalysisPanel - 子向けの分析結果表示
 *
 * 当日検出されたパターンをプラスの言語で表示し、
 * 次のステップ提案を子どもにわかりやすく伝える。
 *
 * - 同一質問繰り返し → 「この話題、よく出てきたね」
 * - 失敗→成功 → 「チャレンジして成功したね！」
 * - 確信度低下 → 「少し疲れてきたのかな。休もうか」
 * - ヒント依存 → 「ヒントをもらいながら学べるのが君のスタイルだね」
 */

import { DailyAnalysisResult, AnalysisPattern } from '@/lib/types/analysis';

interface AnalysisPanelProps {
  result: DailyAnalysisResult;
  childName?: string;
}

/**
 * パターン名を子ども向けの説明に変換
 */
function getChildFriendlyPatternMessage(
  type: string,
  topic: string,
  confidence: number
): string {
  const conf = Math.round(confidence * 100);
  switch (type) {
    case 'repetition':
      return `「${topic}」について、今日は何度も考えていたね！${conf}%の確率で大事な話題かも。`;
    case 'failure-success':
      return `「${topic}」で何度も試してから成功した！挑戦のパワーを感じるね。`;
    case 'mastery':
      return `「${topic}」はすごく理解が進んでいるみたい。${conf}%くらい得意になってきたよ。`;
    case 'confidence-decline':
      return `「${topic}」の回答が短くなってきた。疲れてきたのかな？休憩がいいかも。`;
    case 'hint-dependency':
      return `ヒントをもらいながら学ぶ、それがあなたのスタイル。ぜひどんどん「教えて」と言ってね。`;
    case 'fluency':
      return `「${topic}」の理解がスムーズに進んでいます。${conf}%くらい流暢に答えてる！`;
    default:
      return `「${topic}」について分析しました。${conf}%の確信度で検出。`;
  }
}

/**
 * パターンに基づいた励ましメッセージ
 */
function getEncouragementMessage(patterns: AnalysisPattern[]): string {
  if (patterns.length === 0) {
    return '今日も楽しく学べたね！明日も頑張ろう 💪';
  }

  const hasSuccess = patterns.some((p) => p.type === 'failure-success');
  const hasRepeat = patterns.some((p) => p.type === 'repetition');

  if (hasSuccess) return 'チャレンジして成功できた！その成長が一番大事だよ 🌟';
  if (hasRepeat) return 'くり返し学ぶことで、きっと上手になってくるよ！';
  return 'いろいろなパターンが見つかったね。これからもコツコツ頑張ろう 👍';
}

/**
 * エモーション絵文字（パターン数に応じた喜び度）
 */
function getEmoticon(patterns: AnalysisPattern[]): string {
  if (patterns.length === 0) return '😊';
  if (patterns.some((p) => p.type === 'failure-success')) return '🌟';
  if (patterns.length >= 3) return '🎉';
  return '😊';
}

export function AnalysisPanel({ result, childName = '君' }: AnalysisPanelProps) {
  const patterns = result.patterns.slice(0, 4); // max 4 patterns to show
  const emoticon = getEmoticon(patterns);

  return (
    <div className="w-full bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg border-2 border-purple-200 p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-purple-900">
          {emoticon} 今日のあなたの学習スタイル
        </h2>
        <span className="text-sm text-gray-600">{result.date}</span>
      </div>

      {/* Overall Progress */}
      <div className="bg-white rounded-lg p-4 mb-6 border-l-4 border-purple-400">
        <p className="text-gray-800 leading-relaxed">{result.overallProgress}</p>
      </div>

      {/* Patterns */}
      {patterns.length > 0 ? (
        <div className="space-y-3 mb-6">
          {patterns.map((pattern, i) => {
            const message = getChildFriendlyPatternMessage(
              pattern.type,
              pattern.topic,
              pattern.confidence
            );
            return (
              <div
                key={i}
                className="bg-white rounded-lg p-4 border-l-4 border-green-400 shadow-xs"
              >
                <p className="text-sm text-gray-700 leading-relaxed">{message}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-lg p-4 mb-6 border-l-4 border-gray-300 text-gray-600">
          <p>特別なパターンは見つかりませんでしたが、今日も楽しく学べましたね！</p>
        </div>
      )}

      {/* Recommended Actions */}
      {result.recommendedActions.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            💡 次のステップ（もしやりたかったら）
          </h3>
          <ul className="space-y-2">
            {result.recommendedActions.slice(0, 3).map((action, i) => (
              <li
                key={i}
                className="text-sm text-gray-700 flex items-start gap-2"
              >
                <span className="text-green-500 mt-0.5">✓</span>
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Encouragement */}
      <div className="bg-yellow-50 rounded-lg p-4 border-2 border-yellow-200 text-center">
        <p className="text-lg font-semibold text-yellow-900">
          {getEncouragementMessage(patterns)}
        </p>
      </div>

      {/* Statistics Footer */}
      <div className="mt-6 pt-4 border-t border-gray-200 flex justify-between items-center text-xs text-gray-500">
        <span>対象メッセージ数: {result.messageCount}</span>
        <span>分析時刻: {new Date(result.generatedAt).toLocaleTimeString('ja-JP')}</span>
      </div>
    </div>
  );
}
