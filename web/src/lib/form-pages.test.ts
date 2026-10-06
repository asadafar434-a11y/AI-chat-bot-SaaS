// Страница заголовка бланка из документов закупки — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocator } from "./doc-locate.ts";
import { TextBuilder } from "./doc-source.ts";
import { formPage } from "./form-pages.ts";

const TITLE = "Декларация участника закупки о малом бизнесе";

test("заголовок бланка встречается один раз — страница из метки PDF", () => {
  const locator = createLocator([
    { name: "Извещение.pdf", text: `Общие сведения о закупке.\n\n-- 1 of 2 --\n\n${TITLE}\n2. ИНН\n\n-- 2 of 2 --\n\n` },
  ]);
  assert.equal(formPage(locator, TITLE), "2");
});

test("заголовок в Word — страница приблизительная", () => {
  const b = new TextBuilder();
  b.add(TITLE, { page: 3, head: true });
  b.raw("\n\n");
  const { text, map } = b.build(true);
  const locator = createLocator([{ name: "Извещение.docx", text, map }]);
  assert.equal(formPage(locator, TITLE), "≈ 3");
});

test("заголовок встречается дважды (список приложений и сам бланк) — страницу не называем", () => {
  const locator = createLocator([
    { name: "Извещение.pdf", text: `Приложение № 2 — ${TITLE}\n\n-- 1 of 2 --\n\n${TITLE}\n2. ИНН\n\n-- 2 of 2 --\n\n` },
  ]);
  assert.equal(formPage(locator, TITLE), undefined);
});

test("заголовка нет в документах — страницу не называем", () => {
  const locator = createLocator([{ name: "ТЗ.pdf", text: "Поставка бумаги А4.\n\n-- 1 of 1 --\n\n" }]);
  assert.equal(formPage(locator, TITLE), undefined);
  assert.equal(formPage(locator, "   "), undefined);
});
