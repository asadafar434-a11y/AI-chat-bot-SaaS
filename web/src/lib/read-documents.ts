import type { ChatDocument } from "@/lib/chat-types";

export type SentDocument = Pick<ChatDocument, "name" | "text">;
export type FailedFile = { name: string; reason: string };

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
  return { documents: documents.map(({ name, text }) => ({ name, text })), failed };
}
