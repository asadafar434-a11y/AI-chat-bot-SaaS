import type { ChatDocument } from "@/lib/chat-types";

export type SentDocument = Pick<ChatDocument, "name" | "text" | "scan">;
export type FailedFile = { name: string; reason: string };

// Что можно загрузить: сканы и фото распознаёт ИИ, старый Word и RTF читаются без него.
export const ACCEPTED_FILES = ".pdf,.docx,.doc,.rtf,.txt,.md,.jpg,.jpeg,.png";

// Какие файлы закупки распознаны со скана или фото: ошибка в цифре ТЗ перейдёт в требования и ТП.
export function scanWarning(documents: SentDocument[]): string | null {
  const names = documents.filter((d) => d.scan).map((d) => `«${d.name}»`);
  if (names.length === 0) return null;
  const one = names.length === 1;
  return `${one ? "Файл" : "Файлы"} ${names.join(", ")} ${one ? "распознан" : "распознаны"} со скана — цифры, даты и суммы сверьте с оригиналом.`;
}

// Текст из файлов достаёт сервер. Если не прочитался ни один файл — объясняем почему.
export async function readDocuments(files: File[]): Promise<{ documents: SentDocument[]; failed: FailedFile[] }> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await fetch("/api/documents", { method: "POST", body: form });
  if (!res.ok) throw new Error("Не удалось прочитать файлы — попробуйте ещё раз.");
  const { documents, failed }: { documents: ChatDocument[]; failed: FailedFile[] } = await res.json();
  if (documents.length === 0) {
    throw new Error(
      failed.length
        ? `Не получилось прочитать: ${failed.map((f) => `${f.name} — ${f.reason}`).join("; ")}.`
        : "В файлах нет текста."
    );
  }
  return { documents: documents.map(({ name, text, scan }) => ({ name, text, ...(scan && { scan }) })), failed };
}
