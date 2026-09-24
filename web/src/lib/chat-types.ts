import type { UIMessage } from "ai";

export type ChatDocument = {
  id: string;
  name: string;
  chars: number;
  text: string;
};

export type ChatMessage = UIMessage<{ files?: string[]; date?: string }>;

// ≈ 150–200 тыс. токенов русского текста: заметно меньше окна модели, но уже дорого на каждый вопрос.
export const MAX_CONTEXT_CHARS = 400_000;
