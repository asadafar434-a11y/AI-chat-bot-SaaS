import type { ChatDocument } from "@/lib/chat-types";
import { summaryOf } from "@/lib/doc-source";
import { errorText } from "@/lib/http-error";
import { readScanOcr } from "./scan-setting.ts";

export type SentDocument = Pick<ChatDocument, "name" | "text" | "scan" | "map">;
export type FailedFile = { name: string; reason: string };

// Документы для запроса к серверу: без карты (откуда какой кусок текста). Сервер её не читает, а запрос от неё заметно тяжелее.
export const forServer = (documents: SentDocument[]): SentDocument[] =>
  documents.map(({ name, text, scan }) => ({ name, text, ...(scan && { scan }) }));

// Что можно загрузить: сканы и фото распознаёт ИИ, старый Word и RTF читаются без него.
export const ACCEPTED_FILES = ".pdf,.docx,.doc,.rtf,.xlsx,.xlsm,.zip,.txt,.md,.jpg,.jpeg,.png";

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

// Что видно про файл под его названием: тип, сколько текста прочитано, страницы (у Word — по разметке самого Word), таблицы,
// листы Excel, со скана ли.
export function docMeta(d: SentDocument): string {
  const ext = d.name.includes(".") ? d.name.split(".").pop()!.toUpperCase() : "";
  const s = summaryOf(d.map);
  return [
    ext,
    `${d.text.length.toLocaleString("ru-RU")} симв.`,
    s.pages ? `${s.approx ? "≈ " : ""}${s.pages} стр.` : "",
    s.tables ? `таблиц: ${s.tables}` : "",
    s.sheets > 1 ? `листов: ${s.sheets}` : "",
    d.scan ? "со скана — сверьте цифры" : "прочитан",
  ]
    .filter(Boolean)
    .join(" · ");
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

async function readOne(file: File, send: Send, ocr: boolean): Promise<OneResult> {
  const problem = fileProblem(file);
  if (problem) return { documents: [], failed: [{ name: file.name, reason: problem }] };
  const form = new FormData();
  form.append("files", file);
  if (!ocr) form.append("ocr", "off");
  let res: Response;
  try {
    res = await send("/api/documents", { method: "POST", body: form });
  } catch {
    return { documents: [], failed: [{ name: file.name, reason: "нет связи с сервером — проверьте интернет и повторите" }] };
  }
  if (!res.ok) {
    // В списке файлов причина — про этот файл: «сервер не смог прочитать», а не общее «на сервере что-то сломалось».
    const unread = "сервер не смог прочитать файл — повторите";
    const reason = await errorText(res, unread, { 500: unread, 502: unread });
    return { documents: [], failed: [{ name: file.name, reason }] };
  }
  const { documents, failed }: { documents: ChatDocument[]; failed: FailedFile[] } = await res.json();
  return { documents: documents.map(({ name, text, scan, map }) => ({ name, text, ...(scan && { scan }), ...(map && { map }) })), failed };
}

// Текст из файлов достаёт сервер. Файлы уходят по одному: так запрос не упирается в предел размера,
// а сбой одного файла не роняет остальные. Если не прочитался ни один файл — объясняем почему.
export async function readDocuments(files: File[], send: Send = fetch, ocr = readScanOcr()): Promise<OneResult> {
  if (files.length > MAX_FILES) {
    throw new Error(`За один раз можно загрузить не больше ${MAX_FILES} файлов — остальные добавьте следующим заходом.`);
  }
  const results: OneResult[] = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      results[i] = await readOne(files[i], send, ocr);
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
