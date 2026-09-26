import type { ChatDocument } from "@/lib/chat-types";

export type SentDocument = Pick<ChatDocument, "name" | "text" | "scan">;
export type FailedFile = { name: string; reason: string };

// Что можно загрузить: сканы и фото распознаёт ИИ, старый Word и RTF читаются без него.
export const ACCEPTED_FILES = ".pdf,.docx,.doc,.rtf,.txt,.md,.jpg,.jpeg,.png";

// Файл больше 40 МБ — это уже не документ закупки, а архив сканов: его стоит разделить.
// За один раз — не больше 20 файлов. Те же пределы проверяет сервер.
export const MAX_FILE_MB = 40;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const MAX_FILES = 20;
// Предел тела запроса у прокси входа — proxyClientMaxBodySize в next.config.ts: файл и служебные поля формы.
export const MAX_REQUEST_BYTES = 45 * 1024 * 1024;
// Сколько файлов читается одновременно: сканы распознаются долго, но и сервер не должен захлебнуться.
const PARALLEL = 3;

// Что не так с файлом ещё до отправки — одинаково в браузере и на сервере.
export function fileProblem(file: { size: number }): string | null {
  if (file.size > MAX_FILE_BYTES) return `файл больше ${MAX_FILE_MB} МБ — разделите его на части или сохраните сканы с меньшим разрешением`;
  if (file.size === 0) return "файл пустой";
  return null;
}

// Какие файлы закупки распознаны со скана или фото: ошибка в цифре ТЗ перейдёт в требования и ТП.
export function scanWarning(documents: SentDocument[]): string | null {
  const names = documents.filter((d) => d.scan).map((d) => `«${d.name}»`);
  if (names.length === 0) return null;
  const one = names.length === 1;
  return `${one ? "Файл" : "Файлы"} ${names.join(", ")} ${one ? "распознан" : "распознаны"} со скана — цифры, даты и суммы сверьте с оригиналом.`;
}

type Send = (url: string, init: RequestInit) => Promise<Response>;
type OneResult = { documents: SentDocument[]; failed: FailedFile[] };

async function readOne(file: File, send: Send): Promise<OneResult> {
  const problem = fileProblem(file);
  if (problem) return { documents: [], failed: [{ name: file.name, reason: problem }] };
  const form = new FormData();
  form.append("files", file);
  let res: Response;
  try {
    res = await send("/api/documents", { method: "POST", body: form });
  } catch {
    return { documents: [], failed: [{ name: file.name, reason: "нет связи с сервером — проверьте интернет и повторите" }] };
  }
  if (!res.ok) {
    const reason = (await res.text().catch(() => "")).trim();
    return { documents: [], failed: [{ name: file.name, reason: reason || "сервер не смог прочитать файл — повторите" }] };
  }
  const { documents, failed }: { documents: ChatDocument[]; failed: FailedFile[] } = await res.json();
  return { documents: documents.map(({ name, text, scan }) => ({ name, text, ...(scan && { scan }) })), failed };
}

// Текст из файлов достаёт сервер. Файлы уходят по одному: так запрос не упирается в предел размера,
// а сбой одного файла не роняет остальные. Если не прочитался ни один файл — объясняем почему.
export async function readDocuments(files: File[], send: Send = fetch): Promise<OneResult> {
  if (files.length > MAX_FILES) {
    throw new Error(`За один раз можно загрузить не больше ${MAX_FILES} файлов — остальные добавьте следующим заходом.`);
  }
  const results: OneResult[] = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      results[i] = await readOne(files[i], send);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker));

  const documents = results.flatMap((r) => r.documents);
  const failed = results.flatMap((r) => r.failed);
  if (documents.length === 0) {
    throw new Error(
      failed.length
        ? `Не получилось прочитать: ${failed.map((f) => `${f.name} — ${f.reason}`).join("; ")}.`
        : "В файлах нет текста."
    );
  }
  return { documents, failed };
}
