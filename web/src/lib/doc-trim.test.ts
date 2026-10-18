// Длинная закупка: самые большие таблицы-справочники заменяются пометкой, остальное не трогается — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fitDocuments, MIN_BLOCK_CHARS, trimWarning } from "./doc-trim.ts";
import { forServer } from "./read-documents.ts";

// Таблица из n строк по ~100 знаков: «№ | Товар … | Код | КГ».
const table = (n: number, title = "Перечень") =>
  [`${title}`, "№ | Наименование | Код | Ед.", ...Array.from({ length: n }, (_, i) => `${i + 1} | Товар номер ${i + 1} ${"х".repeat(80)} | 01.11.${i} | КГ`)].join("\n");
const REQS = "Требования к участникам: опыт не менее 20 % начальной цены. Срок оказания услуг: с 01.01.2027.";

test("закупка помещается в предел — документы возвращаются теми же объектами, ни одного знака не тронуто", () => {
  const docs = [{ name: "тз.docx", text: `${REQS}\n\n${table(300)}` }];
  const r = fitDocuments(docs, 1_000_000);
  assert.equal(r.documents, docs);
  assert.deepEqual(r.notes, []);
  assert.equal(trimWarning(docs, 1_000_000), null);
});

test("не помещается — большая таблица заменена пометкой, а требования до и после неё на месте", () => {
  const text = `${REQS}\n\n${table(300)}\n\nПосле таблицы: оплата в течение 7 рабочих дней.`;
  assert.ok(text.length > 30_000);
  const r = fitDocuments([{ name: "тз.docx", text }], 20_000);
  const out = r.documents[0].text;
  assert.ok(out.length < 20_000, `${out.length}`);
  assert.ok(out.includes(REQS) && out.includes("оплата в течение 7 рабочих дней"));
  assert.match(out, /\[Таблица на 301 строк \(\d+ тыс\. знаков\) в запрос не включена/);
  assert.ok(out.includes("«№ | Наименование | Код | Ед.»"), "в пометке видна шапка таблицы");
  assert.ok(!out.includes("Товар номер 150"));
  assert.deepEqual(r.notes.map((n) => [n.name, n.rows]), [["тз.docx", 301]]);
});

test("убирается как можно меньше: из двух больших таблиц — только самая большая, если этого хватает", () => {
  const big = table(600, "Большой справочник");
  const small = table(250, "Меню");
  assert.ok(small.length > MIN_BLOCK_CHARS && small.length < big.length);
  const limit = small.length + 5_000;
  const r = fitDocuments([{ name: "а.docx", text: `${big}

Текст

${small}` }], limit);
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].rows, 601);
  assert.ok(r.documents[0].text.includes("Товар номер 249"), "малая таблица осталась");
});

test("короткие таблицы не трогаются, даже когда всё равно не помещается", () => {
  const docs = [{ name: "а.docx", text: `${table(30)}\n${"слово ".repeat(5000)}` }];
  const r = fitDocuments(docs, 5_000);
  assert.equal(r.documents, docs);
  assert.deepEqual(r.notes, []);
});

test("остальные поля документа (скан) сохраняются", () => {
  const r = fitDocuments([{ name: "а.pdf", text: table(300), scan: true }], 10_000);
  assert.equal(r.documents[0].scan, true);
});

test("предупреждение называет файл, число строк и объём", () => {
  const w = trimWarning([{ name: "тз.docx", text: table(300) }], 10_000);
  assert.match(w ?? "", /«тз\.docx» — таблица на 301 строк/);
  assert.match(w ?? "", /ИИ не увидел/);
});

test("forServer: короткая закупка уходит как есть, карта не отправляется", () => {
  const docs = [{ name: "а.docx", text: "Текст", map: { spans: [] } as never, scan: false }];
  assert.deepEqual(forServer(docs), [{ name: "а.docx", text: "Текст" }]);
});
