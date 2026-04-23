export function LearningSection() {
  const learnings = [
    {
      title: 'Parent-Centric Design',
      description:
        '子どもの成績向上よりも、「親が何をすべきか」を知ることが学習継続の鍵。AI は親への実行形提案を優先する設計。',
      icon: '👨‍👩‍👧',
    },
    {
      title: 'Heuristic-First Architecture',
      description:
        'LLM に全て依存しない。純粋ロジックで信頼性を確保し、LLM は補強に専念。コスト削減・速度向上・テスト容易性を同時達成。',
      icon: '🏗️',
    },
    {
      title: '3 層ストレージ設計',
      description:
        'ブラウザ・Node.js・将来の Cloud DB を想定した設計。単一責任＋拡張性。テスト時は in-memory モック。',
      icon: '💾',
    },
    {
      title: '日本語トークナイザの課題と解法',
      description:
        '形態素解析ライブラリを避け、3 層正規表現 (漢字連続・カタカナ連続・バイグラム) で軽量実装。閾値調整が重要。',
      icon: '🔤',
    },
    {
      title: 'Governance と信頼',
      description:
        'AI エージェントの「権限開通」と「実行開始指示」を明確に分離。実行前に常に確認。ガバナンスを維持しながら作業効率化。',
      icon: '🛡️',
    },
  ];

  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            実装を通じた学び
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            10 営業日の実装で得られた、次のプロジェクトへ活かせる 5 つの重要な洞察
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-12">
          {learnings.map((learning, idx) => (
            <div
              key={idx}
              className="bg-gradient-to-br from-gray-50 to-white rounded-xl p-8 border-l-4 border-blue-500 hover:shadow-lg transition"
            >
              <div className="flex items-start gap-4">
                <span className="text-4xl">{learning.icon}</span>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-gray-900 mb-3">{learning.title}</h3>
                  <p className="text-gray-700 leading-relaxed">{learning.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Challenge & Solution Box */}
        <div className="bg-gradient-to-r from-orange-50 to-red-50 rounded-xl p-8 border-2 border-orange-200">
          <h3 className="text-2xl font-bold text-orange-900 mb-6">
            🔥 直面した課題と解決方法
          </h3>

          <div className="space-y-8">
            <div className="border-l-4 border-orange-500 pl-6">
              <h4 className="font-bold text-orange-800 mb-2">
                ❌ 課題: Gemini API モデル選定の失敗
              </h4>
              <p className="text-gray-700 mb-3">
                `gemini-3.1-flash-preview` が実際には利用できず、デプロイ後にエラーで発覚。
              </p>
              <p className="text-blue-600 font-medium">
                ✅ 解決: ListModels API で実際の利用可能モデルを事前確認。`gemini-2.5-flash`
                に統一。
              </p>
            </div>

            <div className="border-l-4 border-orange-500 pl-6">
              <h4 className="font-bold text-orange-800 mb-2">
                ❌ 課題: チャット入力欄のテキスト読みづらさ
              </h4>
              <p className="text-gray-700 mb-3">
                ブラウザデフォルトの薄いグレーで、Chromebook 上で目視困難。
              </p>
              <p className="text-blue-600 font-medium">
                ✅ 解決: Tailwind `text-gray-900` + `placeholder:text-gray-500` で明示的に指定。
              </p>
            </div>

            <div className="border-l-4 border-orange-500 pl-6">
              <h4 className="font-bold text-orange-800 mb-2">
                ❌ 課題: AG の権限越権実行
              </h4>
              <p className="text-gray-700 mb-3">
                「権限開通」を「実行開始」と誤認し、自動的にデプロイを実行。
              </p>
              <p className="text-blue-600 font-medium">
                ✅ 解決: ガバナンスルールを明確化。「開通」と「実行」を完全分離し、常に確認を挟む。
              </p>
            </div>
          </div>
        </div>

        {/* Future Improvements */}
        <div className="mt-12 bg-blue-50 rounded-xl p-8 border-2 border-blue-200">
          <h3 className="text-2xl font-bold text-blue-900 mb-6">
            🚀 V2.1 へのロードマップ
          </h3>
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h4 className="font-bold text-blue-800 mb-3">Short Term (1-2 週)</h4>
              <ul className="space-y-2 text-gray-700">
                <li className="flex gap-2">
                  <span>📌</span>
                  <span>実機テスト (Chromebook)</span>
                </li>
                <li className="flex gap-2">
                  <span>📌</span>
                  <span>親からのフィードバック収集</span>
                </li>
                <li className="flex gap-2">
                  <span>📌</span>
                  <span>Vercel Cron 定時実行</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-blue-800 mb-3">Medium Term (1 ヶ月)</h4>
              <ul className="space-y-2 text-gray-700">
                <li className="flex gap-2">
                  <span>📌</span>
                  <span>学年選択機能</span>
                </li>
                <li className="flex gap-2">
                  <span>📌</span>
                  <span>スクリーンショット分析</span>
                </li>
                <li className="flex gap-2">
                  <span>📌</span>
                  <span>Google Classroom 連携</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
