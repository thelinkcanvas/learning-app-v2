export function TechStackSection() {
  const stack = [
    {
      category: 'Frontend',
      tools: ['Next.js 16.2', 'React 19', 'Tailwind CSS 4', 'TypeScript'],
      description: 'モダンで高速な Web UI',
    },
    {
      category: 'AI / Analysis',
      tools: ['Gemini 2.5 Flash', 'Pattern Analyzer', 'Heuristic Engine'],
      description: '2層構造の分析エンジン',
    },
    {
      category: 'Storage',
      tools: ['localStorage (PWA)', 'JSON File-based', 'Future: Cloud DB'],
      description: 'オフライン対応 & 拡張性',
    },
    {
      category: 'Testing',
      tools: ['Vitest', 'TypeScript', 'Mock Storage'],
      description: '159 テスト合格・0 エラー',
    },
    {
      category: 'Deployment',
      tools: ['Vercel (Next.js)', 'GitHub', 'Cron Scheduling'],
      description: 'スケーラブルで信頼できる運用',
    },
    {
      category: 'Design System',
      tools: ['Tailwind Blue #3b82f6', 'Tailwind Purple #a855f7', 'Geist Font'],
      description: '統一されたビジュアル言語',
    },
  ];

  return (
    <section id="tech" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            技術スタック
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            モダンな Web 技術と AI の組み合わせで、信頼性と拡張性を両立
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {stack.map((item) => (
            <div
              key={item.category}
              className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-8 border border-gray-200 hover:border-blue-300 transition"
            >
              <h3 className="text-lg font-bold text-gray-900 mb-4">{item.category}</h3>
              <div className="space-y-3 mb-4">
                {item.tools.map((tool) => (
                  <div key={tool} className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                    <span className="text-gray-700 font-medium">{tool}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm text-gray-600 border-t border-gray-300 pt-4">
                {item.description}
              </p>
            </div>
          ))}
        </div>

        {/* Key Decisions */}
        <div className="mt-16 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-8 border-l-4 border-purple-600">
          <h3 className="text-2xl font-bold text-purple-900 mb-6">
            🎯 設計上の重要な決定
          </h3>
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h4 className="font-bold text-purple-800 mb-3">Heuristic First</h4>
              <p className="text-gray-700">
                Gemini API が失敗しても、純粋ロジックで 6 パターンを検出。信頼性と費用効率を両立。
              </p>
            </div>
            <div>
              <h4 className="font-bold text-purple-800 mb-3">PWA Architecture</h4>
              <p className="text-gray-700">
                localStorage でオフライン動作対応。Chromebook での実行を最適化（1280×800）。
              </p>
            </div>
            <div>
              <h4 className="font-bold text-purple-800 mb-3">3 層ストレージ</h4>
              <p className="text-gray-700">
                ブラウザ × Node.js × 将来 Cloud DB を同時サポート。拡張性を確保。
              </p>
            </div>
            <div>
              <h4 className="font-bold text-purple-800 mb-3">JST 固定スケジューラ</h4>
              <p className="text-gray-700">
                ブラウザのタイムゾーン依存を排除。日本国内ユーザーの時刻判定を確実化。
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
