import type { ChatDocument } from "@/lib/chat-types";
import { extractText } from "@/lib/extract-text";

type Failed = { name: string; reason: string };

export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "Нет файлов" }, { status: 400 });
  }

  const documents: ChatDocument[] = [];
  const failed: Failed[] = [];

  for (const file of files) {
    const result = await extractText(file);
    if (!result.ok) {
      failed.push({ name: file.name, reason: result.reason });
    } else if (!result.text.trim()) {
      failed.push({ name: file.name, reason: "в файле нет текста" });
    } else {
      documents.push({
        id: crypto.randomUUID(),
        name: file.name,
        chars: result.text.length,
        text: result.text,
      });
    }
  }

  return Response.json({ documents, failed });
}
