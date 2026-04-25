import Link from 'next/link';

const subjects = [
  { id: 'math', name: '算数', emoji: '🔢', color: 'bg-blue-100 hover:bg-blue-200' },
  { id: 'japanese', name: '国語', emoji: '📖', color: 'bg-red-100 hover:bg-red-200' },
  { id: 'science', name: '理科', emoji: '🔬', color: 'bg-green-100 hover:bg-green-200' },
  { id: 'social', name: '社会', emoji: '🌍', color: 'bg-yellow-100 hover:bg-yellow-200' },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-6 md:p-8">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-12 md:mb-16">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-800 mb-4">📚 学習アプリ</h1>
          <p className="text-lg md:text-xl text-gray-600">どの教科を勉強しますか？</p>
        </div>

        {/* Subject Grid - Responsive */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-8">
          {subjects.map((subject) => (
            <Link
              key={subject.id}
              href={`/learn/${subject.id}`}
              className={`${subject.color} rounded-xl p-6 md:p-8 flex flex-col items-center justify-center transition-all transform hover:scale-110 active:scale-95 shadow-lg cursor-pointer`}
            >
              <span className="text-5xl md:text-6xl mb-3">{subject.emoji}</span>
              <span className="text-lg md:text-xl font-bold text-gray-800 text-center">
                {subject.name}
              </span>
            </Link>
          ))}
        </div>

        {/* Weekly Analytics Button */}
        <Link
          href="/analytics/weekly"
          className="block w-full bg-white hover:bg-indigo-50 border-2 border-indigo-200 hover:border-indigo-400 rounded-xl p-5 md:p-6 text-center shadow-md transition-all transform hover:scale-105 mb-6"
        >
          <div className="flex items-center justify-center gap-3">
            <span className="text-3xl">📊</span>
            <div className="text-left">
              <p className="text-lg md:text-xl font-bold text-indigo-700">今週の分析結果</p>
              <p className="text-sm text-gray-500">4教科の成長率を確認</p>
            </div>
          </div>
        </Link>

        {/* Footer Info */}
        <div className="bg-white rounded-lg p-6 md:p-8 text-center shadow-md">
          <p className="text-lg md:text-xl font-medium text-gray-700">
            💡 先生と一緒に、楽しく学ぼう！
          </p>
        </div>
      </div>
    </div>
  );
}
