/**
 * EIS Document Intelligence — извлечение из PDF.
 *
 * Текстовый слой: pdf-parse (переиспользуется как в extract-text.ts).
 * Блоки страницы: строки → heading (lineHeading из doc-source) либо paragraph
 * (подряд идущие строки сливаются). Таблицы: разметка getTable (по линиям сетки),
 * инжектится для тестов; ошибки разметки не роняют извлечение.
 * Страница без текста — скан/картинка: image-блок + OCR (или ocr_required).
 */

import { lineHeading } from "../../../lib/doc-source.ts";
import { GARBLED_PLACEHOLDER, pageQuality } from "../../../lib/pdf-structure.ts";
import type { OcrProvider } from "./ocr.ts";
import type { EisBlock, EisCell, EisPage, EisTable } from "./types.ts";

export interface PdfTableSource {
  getTables(pageNumbers: number[]): Promise<Map<number, string[][][]>>;
}

/** Разметка через pdf-parse с бюджетом: не дольше ~20s и не больше 100 страниц. */
export function createPdfParseTableSource(parser: {
  getTable: (params: { partial: number[] }) => Promise<{ pages: { num: number; tables: string[][][] }[] }>;
}): PdfTableSource {
  return {
    async getTables(pageNumbers: number[]): Promise<Map<number, string[][][]>> {
      const out = new Map<number, string[][][]>();
      const capped = pageNumbers.slice(0, 100);
      const started = Date.now();
      for (let i = 0; i < capped.length; i += 15) {
        if (Date.now() - started > 20000) break;
        try {
          const result = await parser.getTable({ partial: capped.slice(i, i + 15) });
          for (const page of result.pages) {
            if (page.tables.length > 0) out.set(page.num, page.tables);
          }
        } catch {
          break;
        }
      }
      return out;
    },
  };
}

export interface PdfExtractResult {
  pages: EisPage[];
  tables: EisTable[];
  textStatus: "text" | "ocr_required" | "mixed" | "empty";
  ocrPages: number[];
  truncated: boolean;
}

const MAX_BLOCKS_PER_DOC = 20000;

export async function extractPdf(
  bytes: Uint8Array,
  opts: { tables?: PdfTableSource; ocr?: OcrProvider; ocrPages?: number[] | "auto" },
): Promise<PdfExtractResult> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    const qualities = result.pages.map((page) => pageQuality(page.text));
    const blankPages = result.pages.filter((_, i) => qualities[i] === "blank").map((page) => page.num);
    const wantOcr = opts.ocrPages === "auto" ? blankPages : (opts.ocrPages ?? []);
    const ocrTexts = new Map<number, { text: string; confidence?: number }>();
    if (wantOcr.length > 0 && opts.ocr && opts.ocr.configured) {
      const ocrResult = await opts.ocr.extractOcr({ format: "pdf", bytes, fileName: "document.pdf", pages: wantOcr });
      for (const page of ocrResult.pages) {
        ocrTexts.set(page.pageNumber, { text: page.text, confidence: page.confidence });
      }
    }

    const readable = result.pages.filter((_, i) => qualities[i] === "ok").map((page) => page.num);
    const tableSource = opts.tables ?? createPdfParseTableSource(parser);
    const tablesByPage = await tableSource.getTables(readable);;

    const pages: EisPage[] = [];
    const tables: EisTable[] = [];
    let tableIndex = 0;
    let blockSeq = 0;
    let truncated = false;
    const nextId = (): string => `b${++blockSeq}`;
    const pushBlock = (page: EisPage, block: EisBlock): void => {
      if (blockSeq >= MAX_BLOCKS_PER_DOC) {
        truncated = true;
        return;
      }
      page.blocks.push({ ...block, id: nextId() });
    };

    for (let i = 0; i < result.pages.length; i++) {
      const raw = result.pages[i];
      if (!raw) continue;
      const quality = qualities[i] ?? "blank";
      const page: EisPage = { pageNumber: raw.num, blocks: [], metadata: { quality } };
      const ocr = ocrTexts.get(raw.num);
      if (quality === "blank" && !ocr) {
        // Скан/картинка без текста: OCR-текст обычным извлечённым не считаем.
        page.metadata = { ...page.metadata, ocr: false };
        pushBlock(page, { id: "", type: "image", text: "", source: { kind: "pdf", page: raw.num }, metadata: { ocr: false } });
        pages.push(page);
        continue;
      }
      const text = ocr ? ocr.text : raw.text;
      if (ocr) page.metadata = { ...page.metadata, ocr: true };
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      let para: string[] = [];
      const flushPara = (): void => {
        if (para.length === 0) return;
        pushBlock(page, {
          id: "",
          type: "paragraph",
          text: para.join("\n"),
          source: { kind: "pdf", page: raw.num },
          ...(ocr ? { metadata: { ocr: true, confidence: ocr.confidence } } : {}),
        });
        para = [];
      };
      for (const line of lines) {
        if (!ocr && lineHeading(line)) {
          flushPara();
          pushBlock(page, { id: "", type: "heading", text: line, source: { kind: "pdf", page: raw.num }, metadata: { level: 0, byAppearance: true } });
        } else {
          para.push(line);
        }
      }
      flushPara();
      if (quality === "garbled" && !ocr) {
        pushBlock(page, { id: "", type: "paragraph", text: GARBLED_PLACEHOLDER, source: { kind: "pdf", page: raw.num }, metadata: { garbled: true } });
      }
      const pageTables = tablesByPage.get(raw.num) ?? [];
      for (const grid of pageTables) {
        tableIndex++;
        const rows: EisCell[][] = grid.map((cells, r) =>
          cells.map((cellText, c) => ({ text: cellText.trim(), row: r + 1, column: c + 1 })),
        );
        const table: EisTable = {
          tableIndex,
          pageNumber: raw.num,
          rows,
          metadata: { rows: rows.length, cols: Math.max(0, ...rows.map((r) => r.length)) },
        };
        tables.push(table);
        pushBlock(page, {
          id: "",
          type: "table",
          text: rows.map((r) => r.map((c) => c.text).join(" | ")).join("\n"),
          source: { kind: "pdf", page: raw.num },
          metadata: { tableIndex },
        });
      }
      pages.push(page);
    }

    const withText = pages.filter((p) => p.blocks.some((b) => b.text.trim())).length;
    const ocrPages = pages.filter((p) => p.metadata?.ocr).map((p) => p.pageNumber);
    const textStatus =
      pages.length === 0 || withText === 0 ? (ocrPages.length > 0 ? "text" : pages.length === 0 ? "empty" : "ocr_required")
      : withText < pages.length ? "mixed"
      : "text";
    return { pages, tables, textStatus, ocrPages, truncated };
  } finally {
    await parser.destroy();
  }
}
