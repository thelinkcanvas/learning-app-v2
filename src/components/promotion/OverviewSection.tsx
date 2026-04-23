export function OverviewSection() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            プロジェクト概要
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            学習支援 AI を「親の視点」で再設計。子どもの思考力育成と、親の継続的なガイダンスを両立させるプロダクト。
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {/* What */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-8 border-l-4 border-blue-600">
            <h3 className="text-2xl font-bold text-blue-900 mb-4">What</h3>
            <p className="text-gray-700 leading-relaxed">
              ソクラテス式対話を通じて、子どもの「考える力」を引き出す。同時に、AI が検出した学習パターンを親に可視化し、週末の学習をガイドするプロダクト。
            </p>
          </div>

          {/* Why */}
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-8 border-l-4 border-purple-600">
            <h3 className="text-2xl font-bold text-purple-900 mb-4">Why</h3>
            <p className="text-gray-700 leading-relaxed">
              従来の教育 AI は「成績向上」に特化しがち。しかし、親の継続動機付けなしに、子どもの学習は続かない。親が「何をすべきか」を知ることが、学習継続の鍵。
            </p>
          </div>

          {/* How */}
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-8 border-l-4 border-green-600">
            <h3 className="text-2xl font-bold text-green-900 mb-4">How</h3>
            <p className="text-gray-700 leading-relaxed">
              6つのパターン検出エンジン × Gemini 補強分析 × localStorage PWA。実装は Next.js + TypeScript で、159 テスト合格。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
