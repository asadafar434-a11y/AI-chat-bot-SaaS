// EIS Document Intelligence: PDF-извлечение (текст, заголовки, таблицы, сканы). Запуск: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pdf } from "../../../lib/pdf-fixtures.ts";
import { extractDocument } from "../extract/pipeline.ts";
import { extractPdf } from "../extract/pdf.ts";
import { MockOcrProvider } from "./helpers.ts";

const doc = (bytes: Uint8Array, fileName: string) => ({
  id: fileName,
  tenderRegistryNumber: "0373100130926000001",
  fileName,
  documentType: "notification",
  bytes,
});

test("pdf: страницы, заголовок по виду строки, source page", async () => {
  // Фикстура pdf(): одна строка на страницу.
  const bytes = pdf(["IZVESHCENIE O PROVEDENII ZAPROSA KOTIROVOK", "Postavka bumagi dlya ofisa v kolichestve sta upakovok"]);
  const result = await extractPdf(bytes, {});
  assert.equal(result.pages.length, 2);
  const head = result.pages[0]?.blocks[0];
  assert.equal(head?.type, "heading");
  assert.equal(head?.source.page, 1);
  assert.equal(head?.source.kind, "pdf");
  assert.equal(result.pages[1]?.blocks[0]?.type, "paragraph");
  assert.equal(result.pages[1]?.blocks[0]?.source.page, 2);
  assert.equal(result.textStatus, "text");
  assert.equal(result.truncated, false);
});

test("pdf: несколько страниц сохраняют порядок и номера", async () => {
  const bytes = pdf(["Pervaya stranica s tekstom izveshcheniya", "Vtoraya stranica s usloviyami konkursa"]);
  const result = await extractPdf(bytes, {});
  assert.equal(result.pages.length, 2);
  assert.deepEqual(result.pages.map((p) => p.pageNumber), [1, 2]);
  assert.ok((result.pages[1]?.blocks[0]?.text ?? "").includes("Vtoraya"));
});

test("pdf: таблицы из разметки → table-блоки и tables с row/column", async () => {
  const bytes = pdf(["Tablica s predlozheniyami uchastnikov konkursa"]);
  const result = await extractPdf(bytes, {
    tables: { getTables: async () => new Map([[1, [[["Naimenovanie", "Cena"], ["Bumaga", "150000"]]]]]) },
  });
  assert.equal(result.tables.length, 1);
  const table = result.tables[0];
  assert.ok(table);
  assert.equal(table.pageNumber, 1);
  assert.equal(table.rows[1]?.[1]?.text, "150000");
  assert.equal(table.rows[1]?.[1]?.row, 2);
  assert.equal(table.rows[1]?.[1]?.column, 2);
  const block = result.pages[0]?.blocks.find((b) => b.type === "table");
  assert.ok(block?.text.includes("Bumaga | 150000"));
  assert.equal(block?.metadata?.tableIndex, 1);
});

test("pdf: скан без текстового слоя → image-блок, textStatus ocr_required", async () => {
  const bytes = pdf([null]);
  const result = await extractPdf(bytes, {});
  assert.equal(result.textStatus, "ocr_required");
  assert.equal(result.pages[0]?.blocks[0]?.type, "image");
});

test("pdf: скан + mock OCR → ocr-текст с confidence, обычный текст не выдумывается", async () => {
  const bytes = pdf([null]);
  const result = await extractPdf(bytes, { ocr: new MockOcrProvider(), ocrPages: "auto" });
  assert.equal(result.textStatus, "text");
  assert.deepEqual(result.ocrPages, [1]);
  const block = result.pages[0]?.blocks[0];
  assert.equal(block?.type, "paragraph");
  assert.ok(block?.text.includes("Распознанный текст страницы 1"));
  assert.equal(block?.metadata?.ocr, true);
  assert.equal(block?.metadata?.confidence, 0.9);
});

test("pdf: pipeline помечает скан без провайдера ocr_required + OCR_NOT_CONFIGURED", async () => {
  const bytes = pdf([null]);
  const doc = await extractDocument(
    { id: "scan.pdf", tenderRegistryNumber: "1", fileName: "scan.pdf", documentType: "x", bytes },
    {},
  );
  assert.equal(doc.extraction.method, "pdf-text");
  assert.equal(doc.extraction.status, "ocr_required");
  assert.equal(doc.extraction.ocrError, "OCR_NOT_CONFIGURED");
  assert.match(doc.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(doc.schemaVersion, 1);
});

test("pdf: полный документ через pipeline — структура и хеш", async () => {
  const bytes = pdf(["PROTOKOL RASSMOTRENIYA ZAYAVOK", "Komissiya rassmotrela tri zayavki uchastnikov konkursa"]);
  const normalized = await extractDocument(doc(bytes, "protocol.pdf"), {});
  assert.equal(normalized.document.format, "pdf");
  assert.equal(normalized.extraction.status, "complete");
  assert.equal(normalized.pages.length, 2);
  assert.ok((normalized.pages[0]?.blocks.length ?? 0) >= 1);
});
