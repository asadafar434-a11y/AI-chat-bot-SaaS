import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export type ExtractResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

const kindOf = (file: File) => {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".doc")) return "doc";
  if (/\.(txt|md|csv)$/.test(name) || file.type.startsWith("text/")) return "text";
  return "other";
};

export async function extractText(file: File): Promise<ExtractResult> {
  const kind = kindOf(file);

  try {
    if (kind === "text") {
      return { ok: true, text: await file.text() };
    }

    if (kind === "pdf") {
      const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
      try {
        const { text } = await parser.getText();
        // В скане нет букв — только разделители страниц «-- 1 of 3 --», которые добавляет pdf-parse.
        const letters = text.replace(/-- \d+ of \d+ --/g, "").replace(/[^\p{L}]/gu, "").length;
        if (letters < 20) {
          return { ok: false, reason: "в PDF нет текстового слоя — похоже на скан, нужен OCR" };
        }
        return { ok: true, text };
      } finally {
        await parser.destroy();
      }
    }

    if (kind === "docx") {
      const buffer = Buffer.from(await file.arrayBuffer());
      const { value } = await mammoth.extractRawText({ buffer });
      return { ok: true, text: value };
    }

    if (kind === "doc") {
      return { ok: false, reason: "старый формат .doc — пересохраните файл в .docx" };
    }

    return { ok: false, reason: "формат пока не поддерживается" };
  } catch {
    return { ok: false, reason: "не удалось прочитать файл — возможно, он повреждён или защищён паролем" };
  }
}
