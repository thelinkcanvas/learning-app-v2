'use client';

import { useState, useRef, useEffect } from 'react';
import { callGeminiAPI, saveConversationToLocalStorage } from '@/lib/gemini';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPaneProps {
  subject: string;
}

export default function ChatPane({ subject }: ChatPaneProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setError(null);

    // Add user message to chat
    const newMessages = [...messages, { role: 'user' as const, content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      // Call Gemini API
      const assistantResponse = await callGeminiAPI(userMessage, newMessages);

      // Add assistant response to chat
      const updatedMessages = [
        ...newMessages,
        { role: 'assistant' as const, content: assistantResponse },
      ];
      setMessages(updatedMessages);

      // Save to localStorage
      saveConversationToLocalStorage(subject, updatedMessages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setMessages(newMessages); // Keep the user message visible
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-md p-4">
      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-4 bg-gray-50 p-3 rounded">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-8">
            <p>先生と一緒に勉強しよう！</p>
            <p className="text-sm">質問を入力してね 📚</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-md px-4 py-3 rounded-lg text-sm md:text-base lg:text-lg ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white rounded-br-none'
                  : 'bg-gray-200 text-gray-800 rounded-bl-none'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg rounded-bl-none">
              <p className="text-sm">考え中... ✨</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-100 text-red-700 px-4 py-2 rounded text-sm">
              エラー: {error}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area - Touch-friendly */}
      <div className="flex gap-3 mt-4">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="質問を入力..."
          disabled={isLoading}
          className="flex-1 px-4 py-3 md:py-4 text-base md:text-lg border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 transition"
        />
        <button
          onClick={handleSendMessage}
          disabled={isLoading || !inputValue.trim()}
          className="px-6 md:px-8 py-3 md:py-4 bg-blue-500 text-white text-base md:text-lg rounded-lg hover:bg-blue-600 disabled:bg-gray-300 font-bold transition active:scale-95"
        >
          送信
        </button>
      </div>
    </div>
  );
}
