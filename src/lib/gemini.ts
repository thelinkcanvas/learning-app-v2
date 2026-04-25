const SYSTEM_PROMPT = `
あなたは小学校の家庭教師です。子どもが自分で考える力を育てることが目標です。

【基本ルール】
- 答えを直接教えない。ソクラテス式で問い続ける
- 1回の回答は1文の質問。シンプルに

【行き詰まり対応】
- 「わからない」が1回出たら → ヒントを一言添えて次に進む
- 同じ方向の質問を2回以上繰り返さない
- 「あとあるの？」「もうわからない」などのサインが出たら → 答えを教えてから「なぜそうなるか」を一緒に考える

【会話スタイル】
- 短く、シンプルに
- 褒める時は「いいね」「その通り」と簡潔に
- 絵文字は使わない

【禁止】
- 答えを言う
- 長い説明
- 複数の質問を一度に聞く
- 才能を褒める（「頭いい」）

1文1質問。シンプルに。
`;

interface GeminiMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface GeminiRequestBody {
  contents: {
    role: 'user' | 'model';
    parts: { text: string }[];
  }[];
  systemInstruction?: {
    parts: { text: string }[];
  };
  generationConfig: {
    temperature: number;
    topK: number;
    topP: number;
    maxOutputTokens: number;
  };
}

export async function callGeminiAPI(
  userMessage: string,
  conversationHistory: GeminiMessage[] = []
): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  // Build conversation history for Gemini
  const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [
    ...conversationHistory
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({
        role: (msg.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
        parts: [{ text: msg.content }],
      })),
    {
      role: 'user' as const,
      parts: [{ text: userMessage }],
    },
  ];

  const requestBody: GeminiRequestBody = {
    contents,
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    generationConfig: {
      temperature: 1,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 1024,
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();

  if (
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0]
  ) {
    return data.candidates[0].content.parts[0].text;
  }

  throw new Error('Unexpected Gemini API response format');
}

export function saveConversationToLocalStorage(
  subject: string,
  conversationHistory: GeminiMessage[]
): void {
  if (typeof window === 'undefined') return;

  const key = `conversation_${subject}_${new Date().toISOString().split('T')[0]}`;
  localStorage.setItem(key, JSON.stringify(conversationHistory));
}

export function loadConversationFromLocalStorage(
  subject: string
): GeminiMessage[] {
  if (typeof window === 'undefined') return [];

  const key = `conversation_${subject}_${new Date().toISOString().split('T')[0]}`;
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : [];
}
