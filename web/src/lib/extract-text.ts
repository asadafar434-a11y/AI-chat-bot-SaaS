import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { claudeErrorText } from "@/lib/claude-errors";
import { docText, DocTextError, isOle, rtfText } from "@/lib/doc-text";
import { TextBuilder, type DocMap } from "@/lib/doc-source";
import { DocxError, readDocx } from "@/lib/docx-reader";
import { MAX_SCAN_PAGES, renderPages, transcribe } from "@/lib/ocr";
import { assemblePdf, GARBLED_PLACEHOLDER, letters, pageQuality, type PdfPage } from "@/lib/pdf-structure";
import { plural } from "@/lib/plural";
import { xlsxText } from "@/lib/xlsx-text";
import { createLimiter, OCR_PAGES_TOTAL } from "@/lib/rate-limit";

// scan — текст распознан со скана или фото: в цифрах возможны ошибки. map — откуда в файле каждый кусок текста:
// страница, таблица, строка, лист и ячейка (lib/doc-source.ts); у простого текста её нет.
export type ExtractResult =
  | { ok: true; text: string; scan?: boolean; map?: DocMap }
  | { ok: false; reason: string };

// Чтение скана — запросы к ИИ; в тестах вместо них — заготовки.
export type OcrDeps = { renderPages: typeof renderPages; transcribe: typeof transcribe };
const REAL_OCR: OcrDeps = { renderPages, transcribe };

const kindOf = (file: File) => {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return "xlsx";
  if (name.endsWith(".xls")) return "xls";
  if (name.endsWith(".doc") || name.endsWith(".rtf")) return "doc";
  if (/\.(jpe?g|png)$/.test(name) || /^image\/(jpeg|png)$/.test(file.type)) return "image";
  if (/\.(txt|md|csv)$/.test(name) || file.type.startsWith("text/")) return "text";
  return "other";
};

// Картинку больше 5 МБ модель не примет.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const NO_KEY_SCAN = "это скан — распознавать сканы приложение может, когда подключён ИИ";
const OCR_OFF = "это скан, а распознавание сканов выключено — включите его под кнопкой загрузки или загрузите файл с текстом";
const OCR_LIMIT = "это скан, а дневной лимит распознавания сканов на сервисе исчерпан — загрузите файл с текстом или повторите завтра";

// Каждая страница скана — отдельный запрос к ИИ: за сутки на всех распознаём не больше OCR_PAGES_TOTAL страниц.
const ocrPages = createLimiter(OCR_PAGES_TOTAL);

// Таблицы PDF ищем пачками по страницам и не дольше бюджета: у документа с тысячей чертежей разметка могла бы считаться минутами.
type TableSource = { getTable: (params: { partial: number[] }) => Promise<{ pages: { num: number; tables: string[][][] }[] }> };
const MAX_TABLE_PAGES = 400;

export async function tablesByPage(
  parser: TableSource,
  pages: number[],
  { budgetMs = 20_000, batch = 15, now = Date.now }: { budgetMs?: number; batch?: number; now?: () => number } = {}
): Promise<Map<number, string[][][]>> {
  const out = new Map<number, string[][][]>();
  if (pages.length > MAX_TABLE_PAGES) return out;
  const started = now();
  for (let i = 0; i < pages.length; i += batch) {
    if (now() - started > budgetMs) break;
    try {
      const result = await parser.getTable({ partial: pages.slice(i, i + batch) });
      for (const page of result.pages) if (page.tables.length) out.set(page.num, page.tables);
    } catch (error) {
      // Без разметки таблиц текст страниц остаётся как был: это не повод не читать файл.
      console.error("pdf tables", error);
      break;
    }
  }
  return out;
}

// Страница, на которой почти нет букв, — скан или картинка; страница с буквами не тех письменностей — сломанная кодировка шрифта.
// Текст таких страниц читает ИИ. Так читаются и целиком отсканированные файлы, и обычные PDF с вклеенными сканами,
// например подписанной последней страницей. У остальных страниц таблицы записываются строками (lib/pdf-structure.ts).
async function pdfText(data: Uint8Array, ocr: boolean, deps: OcrDeps): Promise<ExtractResult> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const quality = result.pages.map((page) => pageQuality(page.text));
    const unreadable = result.pages.filter((_, i) => quality[i] !== "ok").map((page) => page.num);
    const allUnreadable = unreadable.length === result.pages.length;

    const recognized = new Map<number, string>();
    if (unreadable.length) {
      if (!process.env.ANTHROPIC_API_KEY || !ocr) {
        if (allUnreadable) return { ok: false, reason: ocr ? NO_KEY_SCAN : OCR_OFF };
      } else if (unreadable.length > MAX_SCAN_PAGES) {
        if (allUnreadable) {
          const n = unreadable.length;
          return { ok: false, reason: `скан на ${n} ${plural(n, "страницу", "страницы", "страниц")} — распознаю не больше ${MAX_SCAN_PAGES}; разделите файл на части` };
        }
      } else if (ocrPages("all", unreadable.length)) {
        if (allUnreadable) return { ok: false, reason: OCR_LIMIT };
      } else {
        const texts = await deps.transcribe(await deps.renderPages(parser, unreadable));
        unreadable.forEach((num, i) => recognized.set(num, texts[i] ?? ""));
      }
    }

    const readable = result.pages.filter((_, i) => quality[i] === "ok").map((page) => page.num);
    const tables = readable.length ? await tablesByPage(parser, readable) : new Map<number, string[][][]>();
    const pages: PdfPage[] = result.pages.map((page, i) => {
      if (quality[i] === "ok") return { num: page.num, text: page.text, tables: tables.get(page.num) };
      const text = recognized.get(page.num);
      if (text !== undefined) return { num: page.num, text: text.trim(), ocr: true };
      return { num: page.num, text: quality[i] === "garbled" ? GARBLED_PLACEHOLDER : page.text };
    });
    const { text, map } = assemblePdf(pages, result.total);
    if (recognized.size && letters(text) < 20) return { ok: false, reason: "на скане не нашлось текста" };
    return { ok: true, text, ...(recognized.size > 0 && { scan: true }), ...(map && { map }) };
  } finally {
    await parser.destroy();
  }
}

// Word читаем напрямую из файла (таблицы, номера пунктов, страницы); не получилось — пересказом текста без разметки.
async function docxText(buffer: Buffer): Promise<{ text: string; map?: DocMap }> {
  try {
    const { text, map } = readDocx(buffer);
    return { text, map };
  } catch (error) {
    // Файл, который наше чтение не взяло, — обычное дело; а сбой в самом чтении стоит видеть в журнале (имени файла в нём нет).
    if (!(error instanceof DocxError)) console.error("docx-reader", error);
    return { text: (await mammoth.extractRawText({ buffer })).value };
  }
}

// .doc у заказчиков бывает трёх видов: настоящий Word 97–2003, RTF с другим расширением и .docx с другим расширением.
async function wordText(buffer: Buffer): Promise<ExtractResult> {
  if (isOle(buffer)) return { ok: true, text: docText(buffer) };
  if (buffer.subarray(0, 5).toString("latin1") === "{\\rtf") return { ok: true, text: rtfText(buffer) };
  if (buffer.subarray(0, 2).toString("latin1") === "PK") {
    const { text, map } = await docxText(buffer);
    return { ok: true, text, ...(map && { map }) };
  }
  return { ok: false, reason: "не похоже на файл Word — пересохраните его в .docx" };
}

// ocr: false — сканы и фото не распознаются: картинки не уходят в ИИ (выключено в браузере).
export async function extractText(file: File, { ocr = true, deps = REAL_OCR }: { ocr?: boolean; deps?: OcrDeps } = {}): Promise<ExtractResult> {
  const kind = kindOf(file);

  try {
    if (kind === "text") {
      return { ok: true, text: await file.text() };
    }

    if (kind === "pdf") {
      return await pdfText(new Uint8Array(await file.arrayBuffer()), ocr, deps);
    }

    if (kind === "docx") {
      const { text, map } = await docxText(Buffer.from(await file.arrayBuffer()));
      return { ok: true, text, ...(map && { map }) };
    }

    if (kind === "xlsx") {
      const { text, map } = await xlsxText(Buffer.from(await file.arrayBuffer()));
      return { ok: true, text, ...(map && { map }) };
    }

    if (kind === "xls") {
      return { ok: false, reason: "старый формат .xls не читается — пересохраните файл как .xlsx" };
    }

    if (kind === "doc") {
      return await wordText(Buffer.from(await file.arrayBuffer()));
    }

    if (kind === "image") {
      if (!ocr) return { ok: false, reason: OCR_OFF };
      if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: NO_KEY_SCAN };
      if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: "фото больше 5 МБ — уменьшите его или отсканируйте документ в PDF" };
      if (ocrPages("all")) return { ok: false, reason: OCR_LIMIT };
      const mediaType = file.type === "image/png" || /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
      const [recognized] = await deps.transcribe([{ data: Buffer.from(await file.arrayBuffer()), mediaType }]);
      if (letters(recognized) < 20) return { ok: false, reason: "на картинке не нашлось текста" };
      const b = new TextBuilder();
      b.add(recognized, { page: 1, ocr: true });
      return { ok: true, scan: true, ...b.build() };
    }

    return { ok: false, reason: "формат пока не поддерживается" };
  } catch (error) {
    // Имя файла в журнал не пишем: в нём бывают ФИО, а сервер документы не хранит — и журналы тоже.
    console.error(`extract ${kind}`, error);
    if (error instanceof DocTextError) return { ok: false, reason: `${error.message} — пересохраните файл в .docx` };
    if (error instanceof Anthropic.APIError) return { ok: false, reason: `не удалось распознать скан. ${claudeErrorText(error)}` };
    return { ok: false, reason: "не удалось прочитать файл — возможно, он повреждён или защищён паролем" };
  }
}
