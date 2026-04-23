export function FeaturesSection() {
  const features = [
    {
      pattern: 'Pattern A',
      title: '同一質問の繰り返し',
      description: '同じテーマの質問が何度も出現 → 理解不足のサイン',
      emoji: '🔄',
      color: 'from-blue-500 to-blue-600',
    },
    {
      pattern: 'Pattern B',
      title: '失敗→成功の遷移',
      description: '間違い → 考え直し → 正解 → 学習成功の軌跡',
      emoji: '📈',
      color: 'from-green-500 to-green-600',
    },
    {
      pattern: 'Pattern C',
      title: '教科別得意・苦手分野',
      description: '単元ごとの成功率パターン → 個別化学習の手がかり',
      emoji: '📊',
      color: 'from-purple-500 to-purple-600',
    },
    {
      pattern: 'Pattern D',
      title: '確信度の低下',
      description: '回答に躊躇が増える → 疲労・集中力低下の可能性',
      emoji: '😴',
      color: 'from-orange-500 to-orange-600',
    },
    {
      pattern: 'Pattern E',
      title: 'ヒント要求頻度',
      description: '「ヒントをください」の頻度 → 学習スタイルの特徴',
      emoji: '💡',
      color: 'from-yellow-500 to-yellow-600',
    },
    {
      pattern: 'Pattern F',
      title: '学習の流暢性',
      description: '会話のテンポと理解速度 → 概念習得の進捗',
      emoji: '⚡',
      color: 'from-pink-500 to-pink-600',
    },
  ];

  return (
    <section id="features" className="py-20 bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            AI が見ている 6 つのパターン
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            毎回の会話から、子どもの学習パターンを自動検出。親と子の次のアクションを導きます。
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <div
              key={feature.pattern}
              className="bg-white rounded-xl shadow-lg hover:shadow-xl transition p-8 border-t-4 border-gray-200"
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="text-3xl">{feature.emoji}</div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-blue-600 mb-1">{feature.pattern}</p>
                  <h3 className="text-xl font-bold text-gray-900">{feature.title}</h3>
                </div>
              </div>
              <p className="text-gray-700 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>

        {/* 2-Layer Architecture */}
        <div className="mt-16 bg-blue-50 rounded-xl p-8 border-2 border-blue-200">
          <h3 className="text-2xl font-bold text-blue-900 mb-6">
            🏗️ 2 層分析アーキテクチャ
          </h3>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h4 className="text-lg font-bold text-blue-800">レイヤー 1: Heuristic（純粋ロジック）</h4>
              <ul className="space-y-2 text-gray-700">
                <li className="flex gap-2">
                  <span>✅</span>
                  <span>6 つのパターンを確実に検出</span>
                </li>
                <li className="flex gap-2">
                  <span>✅</span>
                  <span>Gemini API 失敗時も動作</span>
                </li>
                <li className="flex gap-2">
                  <span>✅</span>
                  <span>完全にテスト可能（159 テスト）</span>
                </li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="text-lg font-bold text-purple-800">
                レイヤー 2: Gemini 補強（AI 分析）
              </h4>
              <ul className="space-y-2 text-gray-700">
                <li className="flex gap-2">
                  <span>✨</span>
                  <span>検出結果を「意味的に検証」</span>
                </li>
                <li className="flex gap-2">
                  <span>✨</span>
                  <span>親向け「実行形」ガイダンス生成</span>
                </li>
                <li className="flex gap-2">
                  <span>✨</span>
                  <span>コスト最適化（月額 ¥2000）</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
