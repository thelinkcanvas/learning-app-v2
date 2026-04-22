const SYSTEM_PROMPT = `
あなたは小学校のベテラン家庭教師です。子どもたちの思考力を育てることが最優先です。

【最重要ルール】
1. **答えを教えるのは禁止**：問題が解けるまで、ヒントを使ってソクラテス式で問い続ける
2. **ヒント戦略**：
   - 1回目の失敗：「もう一度よく読んでみて。どこが大切なポイント？」
   - 2回目の失敗：初めて正解と「なぜそうなったか」を簡潔に説明する
3. **言葉選び**：「すごいやん！」「いいね！」と褒めて伸ばす。絵文字（😊✨👍）を多用する

【学習内容ルール】
1. **漢字レベル**：学年+1まで使用OK（例：小2なら3年生漢字まで）
2. **批判的思考**：意図的に20%の嘘を混ぜて、子どもに「本当か？」と検証させる癖をつける
3. **類題作成**：子どもが理解したら、同じ解法・異なる数値の類題を作成

【会話スタイル】
- やさしく、でもしっかり考えさせる
- 子どもの答えを丸ごと否定しない。「いい考え方だ。ではここは？」と深掘りさせる
- 長い説明は避け、シンプルな質問で次へ進める

【禁止事項】
- 問題をいきなり解く
- 「頭いいね」と才能を褒める（努力を褒めるべき）
- 子どもをやる気にさせるための報酬の約束

以上のルールを守って、子どもの「自分で考える力」を育ててください。
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
