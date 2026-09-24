import type { FailedFile, SentDocument } from "@/lib/read-documents";

// Вопрос с главной передаётся в чат через хранилище вкладки, а не через адрес: текст и документы
// не попадают в историю браузера и переживают перезагрузку страницы при переходе.
// Чат забирает вопрос один раз — после этого он отправлен и повторно не уйдёт.
// Файлы главная читает сама, поэтому здесь уже текст документов.
export type PendingQuestion = { text: string; documents: SentDocument[]; failed: FailedFile[] };

const KEY = "pending-question";

// Копия в памяти — на случай, если документы не влезли в хранилище вкладки.
let memory: PendingQuestion | null = null;

export function setPendingQuestion(question: PendingQuestion) {
  memory = question;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(question));
  } catch {
    // Не влезло или хранилище недоступно — вопрос уйдёт из копии в памяти.
  }
}

export function takePendingQuestion(): PendingQuestion | null {
  let question = memory;
  memory = null;
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    question ??= raw ? (JSON.parse(raw) as PendingQuestion) : null;
  } catch {
    // Хранилище вкладки недоступно — остаётся копия в памяти.
  }
  return question;
}
