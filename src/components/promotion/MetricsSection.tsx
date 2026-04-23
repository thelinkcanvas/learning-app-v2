export function MetricsSection() {
  const metrics = [
    {
      label: 'テスト合格数',
      value: '159',
      unit: 'テスト',
      color: 'from-blue-500 to-blue-600',
      emoji: '✅',
      description: '単体 + 統合テストで完全カバー',
    },
    {
      label: 'ビルドエラー',
      value: '0',
      unit: 'エラー',
      color: 'from-green-500 to-green-600',
      emoji: '🚀',
      description: 'TypeScript 型安全',
    },
    {
      label: 'ビルド時間',
      value: '867',
      unit: 'ms',
      color: 'from-purple-500 to-purple-600',
      emoji: '⚡',
      description: '高速・最適化完了',
    },
    {
      label: 'コード行数',
      value: '~2,500',
      unit: '行',
      color: 'from-orange-500 to-orange-600',
      emoji: '📝',
      description: '精密な実装',
    },
    {
      label: 'API 月額コスト',
      value: '¥2000',
      unit: '/ 月',
      color: 'from-pink-500 to-pink-600',
      emoji: '💰',
      description: 'コスト効率的',
    },
    {
      label: '実装フェーズ',
      value: '完成',
      unit: 'V2',
      color: 'from-indigo-500 to-indigo-600',
      emoji: '🎉',
      description: '本番環境稼働',
    },
  ];

  return (
    <section className="py-20 bg-gradient-to-b from-white to-gray-50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            実装実績
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Day 1 から Day 10 まで、計 10 営業日で完成。品質・テスト・速度を両立。
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="bg-white rounded-xl shadow-lg hover:shadow-xl transition overflow-hidden border border-gray-100"
            >
              <div className={`bg-gradient-to-r ${metric.color} h-2`}></div>
              <div className="p-8">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-4xl">{metric.emoji}</span>
                  <p className="text-sm font-bold text-gray-500 uppercase">{metric.label}</p>
                </div>
                <div className="mb-4">
                  <p className="text-4xl font-bold text-gray-900">{metric.value}</p>
                  <p className="text-sm text-gray-600">{metric.unit}</p>
                </div>
                <p className="text-gray-700 text-sm border-t border-gray-200 pt-4">
                  {metric.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Timeline */}
        <div className="bg-blue-50 rounded-xl p-8 border-2 border-blue-200">
          <h3 className="text-2xl font-bold text-blue-900 mb-8">
            📅 10 営業日の実装スケジュール
          </h3>
          <div className="space-y-6">
            <div className="flex gap-6 items-start">
              <div className="w-24 flex-shrink-0">
                <p className="font-bold text-blue-600">Day 1</p>
              </div>
              <div>
                <p className="font-medium text-gray-900">
                  Next.js 雛形 + API 基盤整備
                </p>
                <p className="text-sm text-gray-600">
                  ホーム画面・教科選択・ルーティング
                </p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="w-24 flex-shrink-0">
                <p className="font-bold text-blue-600">Day 2-3</p>
              </div>
              <div>
                <p className="font-medium text-gray-900">
                  Gemini API 統合 + チャット実装
                </p>
                <p className="text-sm text-gray-600">
                  会話ログ保存・localStorage 実装
                </p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="w-24 flex-shrink-0">
                <p className="font-bold text-blue-600">Day 4-5</p>
              </div>
              <div>
                <p className="font-medium text-gray-900">
                  パターン検出エンジン実装
                </p>
                <p className="text-sm text-gray-600">
                  6 つのパターン認識・単体テスト 159 本
                </p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="w-24 flex-shrink-0">
                <p className="font-bold text-blue-600">Day 6-8</p>
              </div>
              <div>
                <p className="font-medium text-gray-900">
                  分析エンジン・親向けレポート実装
                </p>
                <p className="text-sm text-gray-600">
                  Gemini 補強・UI コンポーネント
                </p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="w-24 flex-shrink-0">
                <p className="font-bold text-blue-600">Day 9-10</p>
              </div>
              <div>
                <p className="font-medium text-gray-900">
                  統合テスト・本番デプロイ
                </p>
                <p className="text-sm text-gray-600">
                  Vercel 本番化・Chromebook 最適化
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
