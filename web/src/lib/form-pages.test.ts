// Страницы бланка из документов закупки — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocator } from "./doc-locate.ts";
import { TextBuilder } from "./doc-source.ts";
import { formPages } from "./form-pages.ts";

const TITLE = "Декларация участника закупки о малом бизнесе";
const FIRST = "Наименование участника";
const LAST = "ИНН участника";
const form = (labels: string[] = [FIRST, LAST]) => ({ title: TITLE, fields: labels.map((label) => ({ label, value: "" })) });

test("страницы от заголовка до последней строки — по меткам страниц PDF", () => {
  const locator = createLocator([
    { name: "Извещение.pdf", text: `Общие сведения.\n\n-- 1 of 3 --\n\n${TITLE}\n1. ${FIRST}\n\n-- 2 of 3 --\n\n2. ${LAST}\n\n-- 3 of 3 --\n\n` },
  ]);
  assert.equal(formPages(locator, form()), "стр. 2–3");
});

test("последняя строка не найдена — называем только первую страницу", () => {
  const locator = createLocator([
    { name: "Извещение.pdf", text: `Общие сведения.\n\n-- 1 of 2 --\n\n${TITLE}\n1. ${FIRST}\n\n-- 2 of 2 --\n\n` },
  ]);
  assert.equal(formPages(locator, form()), "с стр. 2");
});

test("последняя строка стоит раньше заголовка — конец не называем", () => {
  const locator = createLocator([
    { name: "Извещение.pdf", text: `${LAST}\n\n-- 1 of 2 --\n\n${TITLE}\n1. ${FIRST}\n\n-- 2 of 2 --\n\n` },
  ]);
  assert.equal(formPages(locator, form()), "с стр. 2");
});

test("заголовок встречается дважды — страницу не называем", () => {
  const locator = createLocator([
    { name: "Извещение.pdf", text: `Приложение № 2 — ${TITLE}\n\n-- 1 of 2 --\n\n${TITLE}\n1. ${FIRST}\n\n-- 2 of 2 --\n\n` },
  ]);
  assert.equal(formPages(locator, form()), undefined);
});

test("в Word страницы приблизительные", () => {
  const b = new TextBuilder();
  b.add(TITLE, { page: 3, head: true });
  b.raw("\n\n");
  b.add(LAST, { page: 4 });
  b.raw("\n\n");
  const { text, map } = b.build(true);
  const locator = createLocator([{ name: "Извещение.docx", text, map }]);
  assert.equal(formPages(locator, form()), "≈ стр. 3–4");
});

test("заголовка нет в документах или он пустой — страницу не называем", () => {
  const locator = createLocator([{ name: "ТЗ.pdf", text: "Поставка бумаги А4.\n\n-- 1 of 1 --\n\n" }]);
  assert.equal(formPages(locator, form()), undefined);
  assert.equal(formPages(locator, { title: "  ", fields: [] }), undefined);
});
