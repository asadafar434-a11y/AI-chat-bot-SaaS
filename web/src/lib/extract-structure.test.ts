// Чтение файлов с адресом каждого куска текста: Word, Excel и PDF с таблицами, страницы, сканы (ИИ — заготовка),
// сломанная кодировка — npm test. Запросов к ИИ тут нет: распознавание подменено готовыми ответами.
import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { PDFParse } from "pdf-parse";
import type { DocMap, DocSpan } from "./doc-source.ts";
import { c, docx, num, numbering, abstract, lvl, numInstance, p, tbl, tr } from "./docx-fixtures.ts";
import { extractText, tablesByPage, type OcrDeps } from "./extract-text.ts";
import { pdf } from "./pdf-fixtures.ts";
import { GARBLED_PLACEHOLDER } from "./pdf-structure.ts";
import { buildPartPdf } from "./tp-pdf.ts";

const file = (name: string, content: Uint8Array | Buffer | string, type = "") => new File([typeof content === "string" ? content : new Uint8Array(content)], name, { type });

async function withKey<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
  const saved = process.env.ANTHROPIC_API_KEY;
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
}

// Распознавание — готовые ответы по порядку страниц; calls — какие страницы просили распознать.
function fakeOcr(texts: string[]): { deps: OcrDeps; calls: number[][] } {
  const calls: number[][] = [];
  let next = 0;
  return {
    calls,
    deps: {
      renderPages: async (_parser, pages) => {
        calls.push(pages);
        return pages.map(() => ({ data: Buffer.alloc(1), mediaType: "image/png" as const }));
      },
      transcribe: async (images) => images.map(() => texts[next++] ?? ""),
    },
  };
}

type Read = { text: string; scan?: boolean; map?: DocMap };
async function read(f: File, options?: Parameters<typeof extractText>[1]): Promise<Read> {
  const r = await extractText(f, options);
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  return r as Read;
}
const spans = (r: Read) => (r.map?.spans ?? []).map((s) => ({ ...s, t: r.text.slice(s.from, s.to) }));
const cellAt = (r: Read, text: string): Partial<DocSpan> | undefined => {
  const s = spans(r).find((x) => x.t === text);
  return s && { page: s.page, table: s.table, row: s.row, col: s.col, sheet: s.sheet, cell: s.cell, ocr: s.ocr };
};

// ---------- Word ----------

test("Word: таблица строками, номера пунктов, карта с адресом ячеек", async () => {
  const buffer = docx({
    numbering: numbering(abstract(0, lvl(0, "decimal", "%1.")), numInstance(1, 0)),
    body: p("Исполнитель обязан обеспечить площадку.", num(1)) + tbl(tr(c("Показатель"), c("Значение")), tr(c("Звук"), c("не менее 4 кВт"))),
  });
  const r = await read(file("ТЗ.docx", buffer));
  assert.equal(r.text, "1. Исполнитель обязан обеспечить площадку.\n\nПоказатель | Значение\nЗвук | не менее 4 кВт");
  assert.deepEqual(cellAt(r, "не менее 4 кВт"), { page: undefined, table: 1, row: 2, col: 2, sheet: undefined, cell: undefined, ocr: undefined });
});

test("Word: .doc, внутри которого на деле .docx, читается так же — с таблицами и картой", async () => {
  const buffer = docx({ body: tbl(tr(c("Срок"), c("пять рабочих дней"))) });
  const r = await read(file("Проект договора.doc", buffer));
  assert.equal(r.text, "Срок | пять рабочих дней");
  assert.equal(cellAt(r, "пять рабочих дней")?.table, 1);
});

test("Word: файл, который наше чтение не взяло, читается прежним способом — текст есть, карты нет", async () => {
  const mystery = `<w:mystery><w:r><w:t>${"Текст в незнакомой обёртке, а его много. ".repeat(12)}</w:t></w:r></w:mystery>`;
  const r = await read(file("Особый.docx", docx({ body: p("Видимый абзац.") + mystery })));
  assert.match(r.text, /Видимый абзац\./);
  assert.equal(r.map, undefined);
});

// ---------- Excel ----------

test("Excel: лист и адрес каждой ячейки; объединённая ячейка — один раз; пустые колонки пропускаются, адреса остаются настоящими", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Смета");
  sheet.addRow(["Смета на мероприятие", "", ""]);
  sheet.mergeCells("A1:C1");
  sheet.addRow(["№", "Наименование", "", "Цена"]);
  sheet.addRow([1, "Бумага А4", "", 250.5]);
  sheet.addRow([2, "Ручки", "", 15]);
  const second = book.addWorksheet("Итоги");
  second.addRow(["Всего", 3000]);
  const r = await read(file("смета.xlsx", new Uint8Array(await book.xlsx.writeBuffer())));
  assert.equal(
    r.text,
    "## Лист «Смета»\nСмета на мероприятие\n№ | Наименование | Цена\n1 | Бумага А4 | 250,5\n2 | Ручки | 15\n\n## Лист «Итоги»\nВсего | 3000"
  );
  assert.equal(cellAt(r, "Смета на мероприятие")?.cell, "A1");
  assert.equal(cellAt(r, "Бумага А4")?.cell, "B3");
  assert.equal(cellAt(r, "250,5")?.cell, "D3", "колонка C пуста и выброшена, но адрес — как в таблице");
  assert.deepEqual(cellAt(r, "3000"), { page: undefined, table: undefined, row: undefined, col: undefined, sheet: "Итоги", cell: "B1", ocr: undefined });
});

// ---------- PDF ----------

test("PDF с текстом: страницы по меткам, текст как у PDF; карта — страница каждого куска", async () => {
  const r = await withKey(undefined, () => read(file("Извещение.pdf", pdf(["First page text of the notice", "Second page text of the notice"]), "application/pdf")));
  assert.equal(r.text, "First page text of the notice\n\n-- 1 of 2 --\n\nSecond page text of the notice\n\n-- 2 of 2 --");
  assert.deepEqual(spans(r).map((s) => s.page), [1, 2]);
  assert.equal(r.scan, undefined);
});

test("PDF с таблицей: строки «а | б | в», таблица одна на три страницы, номера строк сквозные; текст вокруг не тронут", async () => {
  const rows = [["№", "Наименование", "Количество", "Единица"]];
  for (let i = 1; i <= 70; i++) rows.push([String(i), `Услуга номер ${i} по организации мероприятия`, String(i * 2), "усл. ед."]);
  const buffer = await buildPartPdf({
    title: "Перечень услуг",
    basis: "тест",
    blocks: [
      { type: "paragraph", text: "Приложение 3 к Техническому заданию", rows: [] },
      { type: "table", text: "", rows },
      { type: "paragraph", text: "Итоговое примечание после таблицы.", rows: [] },
    ],
  });
  const r = await withKey(undefined, () => read(file("Перечень.pdf", buffer, "application/pdf")));
  const lines = r.text.split("\n");
  assert.ok(lines.includes("№ | Наименование | Количество | Единица"));
  assert.ok(lines.includes("1 | Услуга номер 1 по организации мероприятия | 2 | усл. ед."));
  assert.ok(lines.includes("70 | Услуга номер 70 по организации мероприятия | 140 | усл. ед."));
  assert.match(r.text, /Приложение 3 к Техническому заданию/);
  assert.match(r.text, /Итоговое примечание после таблицы\./);

  const cells = spans(r).filter((s) => s.table !== undefined);
  assert.deepEqual([...new Set(cells.map((s) => s.table))], [1]);
  assert.ok(new Set(cells.map((s) => s.page)).size >= 2, "таблица прошла по нескольким страницам");
  const seventy = cells.find((s) => s.t === "Услуга номер 70 по организации мероприятия");
  assert.equal(seventy?.row, 71, "шапка — строка 1, значит, семидесятая услуга — строка 71");
  assert.equal(seventy?.col, 2);
});

test("PDF: разметка таблиц не получилась — текст читается и без неё, ошибка попадает в журнал (без имени файла)", async (t) => {
  t.mock.method(PDFParse.prototype, "getTable", async () => {
    throw new Error("разметка не получилась");
  });
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  const r = await withKey(undefined, () => read(file("Иванов Иван — ТЗ.pdf", pdf(["Technical specification of the purchase"]), "application/pdf")));
  assert.match(r.text, /Technical specification of the purchase/);
  assert.ok(logged.length > 0);
  assert.doesNotMatch(logged.flat().map(String).join(" "), /Иванов/);
});

// ---------- сканы и сломанная кодировка (ответы ИИ — заготовки) ----------

test("PDF со сканом: страницы без текста читает ИИ; у них пометка «скан», номер страницы и таблица по «|»", async () => {
  const ocr = fakeOcr(["Справка о квалификации\n\n№ | Заказчик\n1 | ООО «Ромашка»", "Вторая страница скана: подпись руководителя и печать"]);
  const r = await withKey("sk-test", () => read(file("Анкета.pdf", pdf(["Technical specification page", null, null]), "application/pdf"), { deps: ocr.deps }));
  assert.deepEqual(ocr.calls, [[2, 3]]);
  assert.equal(r.scan, true);
  assert.match(r.text, /Technical specification page/);
  assert.match(r.text, /№ \| Заказчик\n1 \| ООО «Ромашка»/);
  const [first, second, third] = [1, 2, 3].map((n) => spans(r).filter((s) => s.page === n));
  assert.ok(first.every((s) => !s.ocr));
  assert.ok(second.every((s) => s.ocr));
  assert.ok(third.every((s) => s.ocr));
  assert.deepEqual(cellAt(r, "ООО «Ромашка»"), { page: 2, table: 1, row: 2, col: 2, sheet: undefined, cell: undefined, ocr: true });
});

test("PDF со сломанной кодировкой: ИИ читает такие страницы как сканы; без него — заметка вместо знаков, остальные страницы целы", async () => {
  const garbled = "\\300\\301\\302\\303\\304\\305\\306\\307\\310\\311".repeat(4);
  const normal = "Technical specification of the purchase of paper";

  const ocr = fakeOcr(["Нормальный текст страницы, прочитанный ИИ"]);
  const withAi = await withKey("sk-test", () => read(file("Договор.pdf", pdf([normal, garbled])), { deps: ocr.deps }));
  assert.deepEqual(ocr.calls, [[2]]);
  assert.match(withAi.text, /Нормальный текст страницы, прочитанный ИИ/);
  assert.doesNotMatch(withAi.text, /ÀÁÂ/);
  assert.equal(withAi.scan, true);

  const without = await withKey(undefined, () => read(file("Договор.pdf", pdf([normal, garbled]))));
  assert.match(without.text, /Technical specification of the purchase of paper/);
  assert.ok(without.text.includes(GARBLED_PLACEHOLDER));
  assert.doesNotMatch(without.text, /ÀÁÂ/);
  assert.equal(without.scan, undefined);

  const all = await withKey("sk-test", () => extractText(file("Договор.pdf", pdf([garbled, garbled])), { ocr: false }));
  assert.equal(all.ok, false);
  assert.match(all.ok ? "" : all.reason, /распознавание сканов выключено/);
});

test("PDF: ИИ не нашёл на скане текста — понятная причина; фото читается с пометкой и адресом", async () => {
  const empty = await withKey("sk-test", () => extractText(file("Пустой скан.pdf", pdf([null])), { deps: fakeOcr(["…"]).deps }));
  assert.deepEqual(empty, { ok: false, reason: "на скане не нашлось текста" });

  const ocr = fakeOcr(["Заявка участника: цена договора четыреста пятьдесят тысяч рублей"]);
  const r = await withKey("sk-test", () => read(file("фото.jpg", new Uint8Array(500), "image/jpeg"), { deps: ocr.deps }));
  assert.equal(r.scan, true);
  assert.deepEqual(r.map, { spans: [{ from: 0, to: r.text.length, page: 1, ocr: true }] });
  const none = await withKey("sk-test", () => extractText(file("фото.jpg", new Uint8Array(500), "image/jpeg"), { deps: fakeOcr(["x"]).deps }));
  assert.deepEqual(none, { ok: false, reason: "на картинке не нашлось текста" });
});

// ---------- разметка таблиц PDF по страницам ----------

const parserOf = (tablesOf: (page: number) => string[][][], calls: number[][] = []) => ({
  getTable: async ({ partial }: { partial: number[] }) => {
    calls.push(partial);
    return { pages: partial.map((num) => ({ num, tables: tablesOf(num) })) };
  },
});

test("разметка таблиц просится пачками по 15 страниц; страницы без таблиц не записываются", async () => {
  const calls: number[][] = [];
  const pages = Array.from({ length: 40 }, (_, i) => i + 1);
  const map = await tablesByPage(parserOf((n) => (n % 10 === 0 ? [[["а", "б"]]] : []), calls), pages);
  assert.deepEqual(calls.map((x) => x.length), [15, 15, 10]);
  assert.deepEqual([...map.keys()], [10, 20, 30, 40]);
});

test("разметка таблиц: бюджет времени кончился — остальные пачки не просим; сбой — берём, что есть; огромный файл — не пытаемся", async (t) => {
  let clock = 0;
  const calls: number[][] = [];
  const slow = {
    getTable: async ({ partial }: { partial: number[] }) => {
      calls.push(partial);
      clock += 8000;
      return { pages: partial.map((num) => ({ num, tables: [[["а", "б"]]] })) };
    },
  };
  const pages = Array.from({ length: 60 }, (_, i) => i + 1);
  const some = await tablesByPage(slow, pages, { budgetMs: 20_000, now: () => clock });
  assert.equal(calls.length, 3, "после трёх пачек прошло 24 секунды из 20");
  assert.equal(some.size, 45);

  t.mock.method(console, "error", () => {});
  let n = 0;
  const flaky = {
    getTable: async ({ partial }: { partial: number[] }) => {
      if (++n === 2) throw new Error("сбой");
      return { pages: partial.map((num) => ({ num, tables: [[["а", "б"]]] })) };
    },
  };
  assert.equal((await tablesByPage(flaky, pages)).size, 15);

  const calls2: number[][] = [];
  const huge = await tablesByPage(parserOf(() => [[["а", "б"]]], calls2), Array.from({ length: 401 }, (_, i) => i + 1));
  assert.equal(huge.size, 0);
  assert.equal(calls2.length, 0);
});
