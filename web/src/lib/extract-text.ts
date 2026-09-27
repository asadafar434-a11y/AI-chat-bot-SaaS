import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { claudeErrorText } from "@/lib/claude-errors";
import { docText, DocTextError, isOle, rtfText } from "@/lib/doc-text";
import { MAX_SCAN_PAGES, renderPages, transcribe } from "@/lib/ocr";
import { plural } from "@/lib/plural";
import { createLimiter, OCR_PAGES_TOTAL } from "@/lib/rate-limit";

// scan — текст распознан со скана или фото: в цифрах возможны ошибки.
export type ExtractResult =
  | { ok: true; text: string; scan?: boolean }
  | { ok: false; reason: string };

const kindOf = (file: File) => {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".doc") || name.endsWith(".rtf")) return "doc";
  if (/\.(jpe?g|png)$/.test(name) || /^image\/(jpeg|png)$/.test(file.type)) return "image";
  if (/\.(txt|md|csv)$/.test(name) || file.type.startsWith("text/")) return "text";
  return "other";
};

const letters = (text: string) => text.replace(/-- \d+ of \d+ --/g, "").replace(/[^\p{L}]/gu, "").length;

// Картинку больше 5 МБ модель не примет.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const NO_KEY_SCAN = "это скан — распознавать сканы приложение может, когда подключён ИИ";
const OCR_OFF = "это скан, а распознавание сканов выключено — включите его под кнопкой загрузки или загрузите файл с текстом";
const OCR_LIMIT = "это скан, а дневной лимит распознавания сканов на сервисе исчерпан — загрузите файл с текстом или повторите завтра";

// Каждая страница скана — отдельный запрос к ИИ: за сутки на всех распознаём не больше OCR_PAGES_TOTAL страниц.
const ocrPages = createLimiter(OCR_PAGES_TOTAL);

// Страница, на которой почти нет букв, — скан или картинка: её текст распознаёт ИИ.
// Так читаются и целиком отсканированные файлы, и обычные PDF с вклеенными сканами, например подписанной последней страницей.
async function pdfText(data: Uint8Array, ocr: boolean): Promise<ExtractResult> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const scanned = result.pages.filter((page) => letters(page.text) < 20).map((page) => page.num);
    const allScanned = scanned.length === result.pages.length;
    if (scanned.length === 0) return { ok: true, text: result.text };
    if (!process.env.ANTHROPIC_API_KEY || !ocr) {
      return allScanned ? { ok: false, reason: ocr ? NO_KEY_SCAN : OCR_OFF } : { ok: true, text: result.text };
    }
    if (scanned.length > MAX_SCAN_PAGES) {
      return allScanned
        ? {
            ok: false,
            reason: `скан на ${scanned.length} ${plural(scanned.length, "страницу", "страницы", "страниц")} — распознаю не больше ${MAX_SCAN_PAGES}; разделите файл на части`,
          }
        : { ok: true, text: result.text };
    }
    if (ocrPages("all", scanned.length)) return allScanned ? { ok: false, reason: OCR_LIMIT } : { ok: true, text: result.text };

    const recognized = await transcribe(await renderPages(parser, scanned));
    const byPage = new Map(scanned.map((num, i) => [num, recognized[i]]));
    const text = result.pages.map((page) => `${byPage.get(page.num) ?? page.text}\n\n-- ${page.num} of ${result.total} --\n\n`).join("");
    if (letters(text) < 20) return { ok: false, reason: "на скане не нашлось текста" };
    return { ok: true, text, scan: true };
  } finally {
    await parser.destroy();
  }
}

// .doc у заказчиков бывает трёх видов: настоящий Word 97–2003, RTF с другим расширением и .docx с другим расширением.
async function wordText(buffer: Buffer): Promise<ExtractResult> {
  if (isOle(buffer)) return { ok: true, text: docText(buffer) };
  if (buffer.subarray(0, 5).toString("latin1") === "{\\rtf") return { ok: true, text: rtfText(buffer) };
  if (buffer.subarray(0, 2).toString("latin1") === "PK") return { ok: true, text: (await mammoth.extractRawText({ buffer })).value };
  return { ok: false, reason: "не похоже на файл Word — пересохраните его в .docx" };
}

// ocr: false — сканы и фото не распознаются: картинки не уходят в ИИ (выключено в браузере).
export async function extractText(file: File, { ocr = true }: { ocr?: boolean } = {}): Promise<ExtractResult> {
  const kind = kindOf(file);

  try {
    if (kind === "text") {
      return { ok: true, text: await file.text() };
    }

    if (kind === "pdf") {
      return await pdfText(new Uint8Array(await file.arrayBuffer()), ocr);
    }

    if (kind === "docx") {
      const buffer = Buffer.from(await file.arrayBuffer());
      const { value } = await mammoth.extractRawText({ buffer });
      return { ok: true, text: value };
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
      const [text] = await transcribe([{ data: Buffer.from(await file.arrayBuffer()), mediaType }]);
      return letters(text) < 20 ? { ok: false, reason: "на картинке не нашлось текста" } : { ok: true, text, scan: true };
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
