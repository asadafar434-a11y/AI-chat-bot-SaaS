import type { ChatDocument } from "@/lib/chat-types";
import { extractText } from "@/lib/extract-text";
import { unzipFiles } from "@/lib/zip-files";
import { fileProblem, MAX_FILE_MB, MAX_FILES, MAX_REQUEST_BYTES } from "@/lib/read-documents";

type Failed = { name: string; reason: string };

// Сканы распознаёт ИИ, постранично: 60-страничный скан читается пару минут.
export const maxDuration = 300;

const fail = (message: string, status: number) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function POST(request: Request) {
  // Браузер шлёт файлы по одному. Тело больше предела прокси (next.config.ts) приходит обрезанным и не разбирается.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    const size = Number(request.headers.get("content-length") ?? 0);
    return size > MAX_REQUEST_BYTES
      ? fail(`Файл не дошёл до сервера целиком: он больше ${MAX_FILE_MB} МБ. Разделите его на части или сохраните сканы с меньшим разрешением.`, 413)
      : fail("Запрос пришёл повреждённым — выберите файлы ещё раз.", 400);
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  // Распознавание сканов выключено в браузере — картинки в ИИ не уходят.
  const ocr = form.get("ocr") !== "off";
  if (files.length === 0) return fail("Нет файлов", 400);
  if (files.length > MAX_FILES) return fail(`За один раз — не больше ${MAX_FILES} файлов.`, 413);

  const documents: ChatDocument[] = [];
  const failed: Failed[] = [];

  // Архив .zip раскладывается на файлы — они читаются как обычные.
  const queue: File[] = [];
  for (const file of files) {
    if (!/.zip$/i.test(file.name)) {
      queue.push(file);
      continue;
    }
    const problem = fileProblem(file);
    if (problem) {
      failed.push({ name: file.name, reason: problem });
      continue;
    }
    const unpacked = unzipFiles(new Uint8Array(await file.arrayBuffer()));
    if ("error" in unpacked) {
      failed.push({ name: file.name, reason: unpacked.error });
      continue;
    }
    for (const skipped of unpacked.skipped) failed.push({ name: `${file.name} → ${skipped.name}`, reason: skipped.reason });
    if (unpacked.files.length === 0) failed.push({ name: file.name, reason: "в архиве нет файлов" });
    queue.push(...unpacked.files);
  }

  for (const file of queue) {
    const problem = fileProblem(file);
    if (problem) {
      failed.push({ name: file.name, reason: problem });
      continue;
    }
    const result = await extractText(file, { ocr });
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
        ...(result.scan && { scan: true }),
        // Откуда в файле каждый кусок текста — страница, таблица, строка, лист (lib/doc-source.ts); сервер её не хранит.
        ...(result.map && { map: result.map }),
      });
    }
  }

  return Response.json({ documents, failed });
}
