import type { UIMessage } from "ai";

export type ChatDocument = {
  id: string;
  name: string;
  chars: number;
  text: string;
};

// files — документы, приложенные к вопросу в общем чате: их имена видны над сообщением.
export type ChatMessage = UIMessage<{ date?: string; files?: string[] }>;

// ≈ 150–200 тыс. токенов русского текста: заметно меньше окна модели, но уже дорого на каждый вопрос.
export const MAX_CONTEXT_CHARS = 400_000;
