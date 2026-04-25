import Link from 'next/link';
import ChatPane from '@/components/ChatPane';
import LeftPanel from '@/components/LeftPanel';

const subjectInfo: Record<string, { name: string; emoji: string }> = {
  math: { name: '算数', emoji: '🔢' },
  japanese: { name: '国語', emoji: '📖' },
  science: { name: '理科', emoji: '🔬' },
  social: { name: '社会', emoji: '🌍' },
};

export default function LearnPage({
  params,
}: {
  params: { subject: string };
}) {
  const subject = params.subject;
  const info = subjectInfo[subject] || { name: '不明', emoji: '❓' };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header - Chromebook/Tablet optimized */}
      <div className="bg-white shadow">
        <div className="px-4 md:px-6 py-4 md:py-5 flex items-center justify-between">
          <Link
            href="/"
            className="text-gray-600 hover:text-gray-900 text-base md:text-lg font-medium px-3 py-2 hover:bg-gray-100 rounded transition"
          >
            ← 戻る
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-800 flex-1 text-center">
            {info.emoji} {info.name}
          </h1>
          <div className="w-20 md:w-24" /> {/* Spacer for alignment */}
        </div>
      </div>

      {/* Main Content - Chromebook (1280×800) optimized */}
      <div className="px-4 md:px-6 py-6 h-[calc(100vh-100px)]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full">
          {/* Left: LeftPanel（ヒント画像 or 分析結果） - Desktop only */}
          <div className="hidden md:flex flex-col overflow-hidden rounded-lg shadow bg-white">
            <LeftPanel subject={subject} />
          </div>

          {/* Right: Chat Pane - Full width on mobile */}
          <div className="flex flex-col overflow-hidden rounded-lg shadow">
            <ChatPane subject={subject} />
          </div>

          {/* Mobile: LeftPanel below chat */}
          <div className="md:hidden col-span-1 overflow-hidden rounded-lg shadow bg-white">
            <LeftPanel subject={subject} />
          </div>
        </div>
      </div>
    </div>
  );
}
