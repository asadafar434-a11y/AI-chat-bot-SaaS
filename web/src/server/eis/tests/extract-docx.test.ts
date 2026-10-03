// EIS Document Intelligence: DOCX-извлечение (порядок, headings, lists, tables). Запуск: npm test.
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { test } from "node:test";
import { abstract, c, docx, lvl, num, numbering, numInstance, p, styles, style, tbl, tr } from "../../../lib/docx-fixtures.ts";
import { extractDocx } from "../extract/docx.ts";
import { extractDocument } from "../extract/pipeline.ts";

const input = (bytes: Uint8Array) => ({
  id: "tz.docx",
  tenderRegistryNumber: "0373100130926000001",
  fileName: "tz.docx",
  documentType: "tz",
  bytes,
});

test("docx: порядок блоков, heading по стилю, paragraph, source paragraph", () => {
  const bytes = docx({
    body: p("Техническое задание", '<w:pStyle w:val="Heading1"/>') + p("Поставка бумаги для офиса."),
    styles: styles(style("Heading1", "heading 1")),
  });
  const result = extractDocx(bytes);
  assert.equal(result.tables.length, 0);
  const blocks = result.pages[0]?.blocks ?? [];
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph"]);
  assert.equal(blocks[0]?.text, "Техническое задание");
  assert.equal(blocks[0]?.metadata?.level, 1);
  assert.equal(blocks[0]?.source.paragraph, 1);
  assert.equal(blocks[1]?.source.paragraph, 2);
  assert.equal(blocks[1]?.source.kind, "docx");
});

test("docx: список фиксируется с listId/level", () => {
  const bytes = docx({
    body: p("Первый пункт", num(3)) + p("Второй пункт", num(3)),
    numbering: numbering(abstract(7, lvl(0, "decimal", "%1.")), numInstance(3, 7)),
  });
  const blocks = extractDocx(bytes).pages[0]?.blocks ?? [];
  assert.deepEqual(blocks.map((b) => b.type), ["list", "list"]);
  assert.equal(blocks[0]?.metadata?.listLevel, 0);
  assert.ok((blocks[0]?.metadata?.listId ?? "").startsWith("3/"));
});

test("docx: таблица с объединением — rows/cells row/column/colSpan", () => {
  const bytes = docx({
    body: tbl(tr(c("Наименование"), c("Цена")), tr(c("Бумага"), c("150000", '<w:gridSpan w:val="2"/>'))),
  });
  const result = extractDocx(bytes);
  assert.equal(result.tables.length, 1);
  const table = result.tables[0];
  assert.ok(table);
  assert.equal(table.rows[0]?.[0]?.text, "Наименование");
  assert.equal(table.rows[1]?.[1]?.column, 2);
  assert.equal(table.rows[0]?.[0]?.row, 1);
  assert.equal(table.rows[0]?.[0]?.column, 1);
  const block = result.pages[0]?.blocks.find((b) => b.type === "table");
  assert.ok(block?.text.includes("Бумага | 150000"));
  assert.equal(block?.metadata?.tableIndex, 1);
});

test("docx: сноски — отдельные footnote-блоки с noteId", () => {
  const bytes = docx({
    body: p("Текст со сноской."),
    footnotes:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:footnote w:id="1"><w:p><w:r><w:t>Текст сноски</w:t></w:r></w:p></w:footnote></w:footnotes>`,
  });
  const blocks = extractDocx(bytes).pages[0]?.blocks ?? [];
  const note = blocks.find((b) => b.type === "footnote");
  assert.ok(note);
  assert.equal(note.text, "Текст сноски");
  assert.equal(note.metadata?.noteId, "1");
});

test("docx: колонтитулы — header/footer блоки", () => {
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // Builder фикстур колонтитулы не поддерживает — собираем минимальный пакет вручную.
  const bytes = zipSync({
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document ${NS}><w:body><w:p><w:r><w:t>Тело документа.</w:t></w:r></w:p></w:body></w:document>`,
    ),
    "word/header1.xml": strToU8(
      `<?xml version="1.0"?><w:hdr ${NS}><w:p><w:r><w:t>Верхний колонтитул</w:t></w:r></w:p></w:hdr>`,
    ),
    "word/footer1.xml": strToU8(
      `<?xml version="1.0"?><w:ftr ${NS}><w:p><w:r><w:t>Стр. 1</w:t></w:r></w:p></w:ftr>`,
    ),
  });
  const blocks = extractDocx(bytes).pages[0]?.blocks ?? [];
  assert.deepEqual(blocks.map((b) => b.type), ["paragraph", "header", "footer"]);
  assert.equal(blocks[1]?.text, "Верхний колонтитул");
});

test("docx: pipeline — полный проход и битый файл", async () => {
  const bytes = docx({ body: p("Раздел первый.") + p("Содержание раздела.") });
  const normalized = await extractDocument(input(bytes), {});
  assert.equal(normalized.document.format, "docx");
  assert.equal(normalized.extraction.status, "complete");
  assert.equal(normalized.extraction.method, "docx");
  assert.equal(normalized.pages.length, 1);

  const broken = await extractDocument(input(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])), {});
  assert.equal(broken.extraction.status, "failed");
  assert.ok(broken.extraction.error);
});
