export function HeroSection() {
  return (
    <section className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-white flex items-center">
      <div className="max-w-7xl mx-auto px-6 py-20 w-full">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Left: Text */}
          <div className="space-y-8">
            <div className="space-y-4">
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-gray-900 leading-tight">
                Learning App
                <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  {' '}V2
                </span>
              </h1>
              <p className="text-xl md:text-2xl text-gray-600 leading-relaxed">
                AI 家庭教師で「思考力」を育てる学習 PWA
              </p>
            </div>

            <div className="space-y-3 text-lg text-gray-700">
              <p className="flex items-start gap-3">
                <span className="text-2xl">🧠</span>
                <span>6つのパターン認識エンジンで学習傾向を自動分析</span>
              </p>
              <p className="flex items-start gap-3">
                <span className="text-2xl">✨</span>
                <span>Gemini 補強分析による個別化ガイダンス</span>
              </p>
              <p className="flex items-start gap-3">
                <span className="text-2xl">👨‍👩‍👧</span>
                <span>親向け実行形学習提案で週末を有効活用</span>
              </p>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-wrap gap-4 pt-4">
              <a
                href="/"
                className="px-8 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition transform hover:scale-105"
              >
                🚀 デモを試す
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-3 border-2 border-gray-300 text-gray-800 font-bold rounded-lg hover:border-blue-600 hover:text-blue-600 transition"
              >
                💻 コードを見る
              </a>
            </div>

            {/* Metrics Quick View */}
            <div className="flex gap-8 pt-8 border-t border-gray-300">
              <div>
                <p className="text-3xl font-bold text-blue-600">159</p>
                <p className="text-gray-600">テスト合格</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-purple-600">0</p>
                <p className="text-gray-600">ビルドエラー</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-green-600">867ms</p>
                <p className="text-gray-600">ビルド時間</p>
              </div>
            </div>
          </div>

          {/* Right: Visual */}
          <div className="relative h-96 md:h-[500px] bg-gradient-to-br from-blue-100 to-purple-100 rounded-2xl border-4 border-blue-200 flex items-center justify-center shadow-2xl">
            <div className="text-center space-y-4">
              <div className="text-6xl">📱</div>
              <p className="text-gray-600 font-medium">Learning App デモスクリーンショット</p>
              <p className="text-sm text-gray-500">(実装フェーズで追加予定)</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
