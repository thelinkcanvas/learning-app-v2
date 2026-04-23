export function CTASection() {
  return (
    <section className="py-20 bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-4xl mx-auto px-6">
        <div className="bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl p-12 md:p-16 text-center text-white shadow-2xl">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            さあ、始めてみませんか？
          </h2>

          <p className="text-lg md:text-xl text-blue-100 mb-12 max-w-2xl mx-auto leading-relaxed">
            Learning App V2 は、子どもの「思考力」と親の「学習支援スキル」を同時に育成する設計になっています。
            <br />
            詳細なコードから、実装の工夫まで、すべてを公開しています。
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-wrap justify-center gap-4 mb-12">
            <a
              href="/"
              className="px-8 py-4 bg-white text-blue-600 font-bold text-lg rounded-lg hover:bg-blue-50 transition transform hover:scale-105 shadow-lg"
            >
              🚀 デモを試す
            </a>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 border-2 border-white text-white font-bold text-lg rounded-lg hover:bg-white hover:text-purple-600 transition transform hover:scale-105"
            >
              💻 GitHub で詳細を見る
            </a>
          </div>

          {/* Additional Info */}
          <div className="bg-white bg-opacity-10 rounded-lg p-6 md:p-8 backdrop-blur">
            <h3 className="text-xl font-bold mb-4">📚 ドキュメント</h3>
            <div className="grid md:grid-cols-3 gap-4 text-left text-blue-50">
              <div>
                <p className="font-bold mb-2">🏗️ アーキテクチャ</p>
                <p className="text-sm">
                  Heuristic + Gemini の 2 層設計。詳細な図解ドキュメント付き
                </p>
              </div>
              <div>
                <p className="font-bold mb-2">🧪 テスト</p>
                <p className="text-sm">
                  159 テスト合格。単体テストから E2E テストまで網羅
                </p>
              </div>
              <div>
                <p className="font-bold mb-2">📖 実装ガイド</p>
                <p className="text-sm">
                  Pattern Analyzer の実装方法。他プロジェクトで再利用可能
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* FAQ-style Info */}
        <div className="mt-16 space-y-6">
          <div className="bg-white rounded-lg shadow p-8 border-l-4 border-blue-600">
            <h3 className="text-lg font-bold text-gray-900 mb-3">
              ❓ 「思考力を育てる」とは何か？
            </h3>
            <p className="text-gray-700">
              与えられた答えを覚えるのではなく、「なぜそうなるのか」を自分の言葉で説明できる力です。Learning
              App はソクラテス式対話で、この力を引き出します。
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-8 border-l-4 border-purple-600">
            <h3 className="text-lg font-bold text-gray-900 mb-3">
              ❓ 親向けレポートで何ができる？
            </h3>
            <p className="text-gray-700">
              「お子さんは同じ質問を 3 回繰り返しています。繰り上がりの概念をブロックで体験させることをお勧めします」というように、具体的なアクションが提示されます。親が週末に即座に実行できる形です。
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-8 border-l-4 border-green-600">
            <h3 className="text-lg font-bold text-gray-900 mb-3">
              ❓ コスト（月額 ¥2000）は何に使われている？
            </h3>
            <p className="text-gray-700">
              Gemini API の API コール代。毎日 20 時に 1 回、金曜夜に 1 回、親向けレポート生成時に 1 回。
              純粋ロジックで検出できるため、AI コールを最小化しています。
            </p>
          </div>
        </div>

        {/* Contact / Feedback */}
        <div className="mt-16 text-center">
          <p className="text-gray-600 mb-4">
            質問・フィードバック・使用報告は以下までお送りください
          </p>
          <a
            href="mailto:horikatu791225@gmail.com"
            className="text-blue-600 font-bold hover:text-blue-700 transition text-lg"
          >
            📧 horikatu791225@gmail.com
          </a>
        </div>
      </div>
    </section>
  );
}
