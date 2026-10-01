import type { UIMessage } from "ai";
import type { DocMap } from "@/lib/doc-source";

export type ChatDocument = {
  id: string;
  name: string;
  chars: number;
  text: string;
  // Текст распознан со скана или фото — в цифрах возможны ошибки.
  scan?: boolean;
  // Откуда в файле каждый кусок текста: страница, таблица, строка, лист, ячейка.
  map?: DocMap;
};

// files — документы, приложенные к вопросу в общем чате: их имена видны над сообщением.
export type ChatMessage = UIMessage<{ date?: string; files?: string[] }>;

// ≈ 150–200 тыс. токенов русского текста: заметно меньше окна модели, но уже дорого на каждый вопрос.
export const MAX_CONTEXT_CHARS = 400_000;
