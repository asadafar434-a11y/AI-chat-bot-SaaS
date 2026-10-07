// Папка документов → отчёт и текст для базы знаний; сохранение базы в файл — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EisNormalizedDocument } from "../server/eis/extract/types.ts";
import { dedupeByText, documentText, documentTypeOf, normativeDocumentType, reportOf, summarize } from "./kb-folder.ts";
import { localEmbedder } from "./kb-embed.ts";
import { ingestDocument } from "./kb-ingest.ts";
import { createMemoryKbStore } from "./kb-store.ts";
import { searchKnowledge } from "./kb-search.ts";

const doc = (over: Partial<{ format: string; fileName: string; status: string; textStatus: string; error: string; pages: { pageNumber: number; blocks: { text: string }[] }[]; children: EisNormalizedDocument[] }>): EisNormalizedDocument =>
  ({
    schemaVersion: 1,
    document: { id: "d", tenderRegistryNumber: "folder", fileName: over.fileName ?? "a.docx", documentType: "folder", format: over.format ?? "docx", sha256: "x", size: 1 },
    pages: (over.pages ?? []).map((p) => ({ pageNumber: p.pageNumber, blocks: p.blocks.map((b, i) => ({ id: `b${i}`, type: "paragraph", text: b.text, source: { kind: "docx" } })) })),
    tables: [],
    children: over.children,
    extraction: { method: "docx", status: over.status ?? "complete", textStatus: over.textStatus ?? "text", error: over.error, stats: { pages: 1, blocks: 1, tables: 0 } },
    sourceSha256: "x",
    extractorVersion: "test",
    extractedAt: "2026-10-06T00:00:00Z",
  }) as unknown as EisNormalizedDocument;

test("текст документа: страницы по порядку, пустые блоки пропускаются", () => {
  const text = documentText(
    doc({
      pages: [
        { pageNumber: 2, blocks: [{ text: "вторая" }] },
        { pageNumber: 1, blocks: [{ text: "первая" }, { text: "   " }] },
      ],
    }),
  );
  assert.equal(text, "первая\n\nвторая");
});

test("читаемый документ даёт статус readable и число знаков", () => {
  const r = reportOf("a.docx", doc({ pages: [{ pageNumber: 1, blocks: [{ text: "Обеспечение заявки" }] }] }));
  assert.equal(r.status, "readable");
  assert.equal(r.chars, "Обеспечение заявки".length);
});

test("скан без текстового слоя — needs_ocr и без текста", () => {
  const r = reportOf("scan.pdf", doc({ format: "pdf", textStatus: "ocr_required", status: "ocr_required", pages: [] }));
  assert.equal(r.status, "needs_ocr");
  assert.equal(r.chars, 0);
});

test("часть страниц без текста — partial с пометкой", () => {
  const r = reportOf("p.pdf", doc({ format: "pdf", textStatus: "mixed", pages: [{ pageNumber: 1, blocks: [{ text: "есть" }] }] }));
  assert.equal(r.status, "partial");
  assert.match(r.note ?? "", /без текста/);
});

test("неизвестный формат (например, старый .doc) — unsupported, ошибка не прячется", () => {
  const r = reportOf("old.doc", doc({ format: "unknown", status: "failed", error: "формат не распознан" }));
  assert.equal(r.status, "unsupported");
  assert.equal(r.note, "формат не распознан");
});

test("архив не попадает в базу сам, отчитываемся по вложениям", () => {
  const archive = reportOf("g.zip", doc({ format: "zip", children: [doc({ fileName: "анкета.docx", pages: [{ pageNumber: 1, blocks: [{ text: "текст" }] }] })] }));
  assert.equal(archive.status, "archive");
  assert.equal(archive.children[0].status, "readable");
  assert.equal(archive.children[0].path, "g.zip!анкета.docx");
  assert.equal(summarize([archive]).readable, 1);
});

test("вид документа из разметки: образцы и протоколы — примеры, остальное — прочее", () => {
  assert.equal(documentTypeOf("образец участника"), "filled_example");
  assert.equal(documentTypeOf("протокол"), "filled_example");
  assert.equal(documentTypeOf("извещение"), "other");
  assert.equal(documentTypeOf(undefined), "other");
});

test("база сохраняется в файл и читается обратно с тем же поиском", async () => {
  const store = createMemoryKbStore();
  await ingestDocument(store, localEmbedder, {
    owner: { kind: "org", organizationId: "cklorgaaaaaaaaaaaaaaaaa1" },
    sourceKey: "folder:анкета.docx",
    name: "Анкета",
    source: "тест",
    text: "Анкета исполнителя: опыт оказания услуг по обслуживанию зданий более трёх лет.",
    meta: { documentType: "filled_example" },
  });
  const saved = JSON.stringify(store.snapshot());
  const restored = createMemoryKbStore(JSON.parse(saved));
  const hits = await searchKnowledge(restored, localEmbedder, {
    query: "опыт оказания услуг",
    visibility: { organizationId: "cklorgaaaaaaaaaaaaaaaaa1" },
  });
  assert.equal(hits[0]?.documentName, "Анкета");
  const other = await searchKnowledge(restored, localEmbedder, { query: "опыт оказания услуг", visibility: { organizationId: null } });
  assert.equal(other.length, 0, "документ организации не виден общей базе после загрузки из файла");
});

test("одинаковые тексты: одна копия, обычный файл важнее вложения архива и папки «архив»", () => {
  const { kept, duplicates } = dedupeByText([
    { path: "архив 223/Декларация.pdf", text: "Декларация" },
    { path: "44/Декларация.pdf", text: "Декларация" },
    { path: "44/x.zip!Декларация.pdf", text: "Декларация" },
    { path: "44/Анкета.docx", text: "Анкета" },
  ]);
  assert.deepEqual(kept, ["44/Анкета.docx", "44/Декларация.pdf"]);
  assert.deepEqual(duplicates, [
    { path: "44/x.zip!Декларация.pdf", of: "44/Декларация.pdf" },
    { path: "архив 223/Декларация.pdf", of: "44/Декларация.pdf" },
  ]);
});

test("нормативная папка: подпапка задаёт тип документа — акты и кодексы нормативны, письма — инструкция", () => {
  assert.equal(normativeDocumentType("База знаний (нормативная)/Подзаконные акты/ПП № 1352.txt"), "regulation");
  assert.equal(normativeDocumentType("База знаний (нормативная)/Кодексы и специальные законы/КоАП.txt"), "law");
  assert.equal(normativeDocumentType("База знаний (нормативная)/Письма Минфина и ФАС/Письмо.txt"), "instruction");
  assert.equal(normativeDocumentType("База знаний (нормативная)/README.txt"), null, "корень папки — не подпапка с типом");
  assert.equal(normativeDocumentType("44/Декларация.pdf"), null, "вне нормативной папки — не трогаем");
});
