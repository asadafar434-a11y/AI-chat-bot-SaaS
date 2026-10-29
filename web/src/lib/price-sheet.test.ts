// Единый расчёт цен по позициям для любой закупки: интернет → документ заказчика → аналоги → «без цены» — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { findCustomerPriceTable } from "./customer-price-table.ts";
import { BRATSK } from "./customer-price-table.fixture.ts";
import { executionCost } from "./execution-cost.ts";
import type { PositionPriceRow, PositionPrices } from "./position-prices.ts";
import { buildPriceSheet } from "./price-sheet.ts";

const row = (id: string, name: string, qty: string, over: Partial<PositionPriceRow> = {}): PositionPriceRow => ({
  id, name, unit: "шт", qty, customerUnit: null, state: "none", median: null, range: null, n: 0, gapPct: null, sources: [], cost: null, unitPrices: [], analogs: null, ...over,
});
const prices = (rows: PositionPriceRow[]): PositionPrices => ({ rows, priced: 0, cost: null, costPositions: 0, asOf: "2026-10-29" });
const web = (p: number[]): Partial<PositionPriceRow> => ({ state: "found", unitPrices: p, median: p[Math.floor(p.length / 2)], range: { from: p[0], to: p[p.length - 1] }, n: p.length, sources: [{ host: "shop.ru", product: "x", price: p[0], date: "2026-10-29", url: null }] });
const table = findCustomerPriceTable([{ name: "Извещение .docx", text: BRATSK }])!;

test("есть цена в интернете и она похожа на правду — берётся она; нет — цена из документа заказчика; нет и её — аналоги; нет ничего — «без цены»", () => {
  const sheet = buildPriceSheet(
    prices([
      row("a", "Офисное кресло Chairman 696 LT", "7", web([5_224, 5_900, 6_400])),
      row("b", "Кровать односпальная с металлическим основанием", "20"),
      row("c", "Шкаф для одежды", "3", { analogs: { n: 2, range: { from: 9_000, to: 11_000 }, sources: [] } }),
      row("d", "Холодильник", "1"),
    ]),
    table,
  );
  const by = Object.fromEntries(sheet.rows.map((r) => [r.id, r]));
  assert.equal(by.a.used, "internet");
  assert.equal(by.b.used, "document", "кровати в интернете нет — цена из таблицы заказчика (22 010,67)");
  assert.equal(by.b.total, 440_213.4);
  assert.equal(by.c.used, "analog");
  assert.equal(by.d.used, "none");
  assert.deepEqual(sheet.counts, { internet: 1, document: 1, analog: 1, missing: 1 });
  assert.deepEqual(sheet.table!.internet, { found: 1, analogs: 1, filled: 1, missing: 1 });
  assert.equal(executionCost(sheet.table!, 1_000_000).verdict.title, "Цен найдено не по всем позициям", "есть позиция без цены — вывод «можно» не делается");
});

test("цена из интернета в 2 раза ниже самой низкой у заказчика — похоже, не тот товар: берётся документ, строка помечена", () => {
  const sheet = buildPriceSheet(prices([row("b", "Кровать односпальная с металлическим основанием", "20", web([7_040]))]), table);
  const r = sheet.rows[0];
  assert.equal(r.used, "document");
  assert.equal(r.webDiffers, true);
  assert.equal(r.web!.mid, 7_040, "цена из интернета всё равно показана");
  const near = buildPriceSheet(prices([row("b", "Кровать односпальная с металлическим основанием", "20", web([15_000]))]), table);
  assert.equal(near.rows[0].used, "internet", "15 000 — не меньше половины самой низкой (19 642 / 2): берётся интернет");
});

test("закупка без таблицы заказчика: цена за единицу из документа (спецификация) заменяет отсутствующую цену в интернете; без неё — «без цены»", () => {
  const sheet = buildPriceSheet(prices([row("a", "Тумба", "50", web([7_454, 9_500, 9_700])), row("b", "Комод", "15", { customerUnit: 8_000 }), row("c", "Стул", "20")]), null);
  assert.deepEqual(sheet.counts, { internet: 1, document: 1, analog: 0, missing: 1 });
  assert.equal(sheet.rows.find((r) => r.id === "b")!.total, 120_000);
});

test("НДС прибавляется один раз к цене из интернета: 2 600 ₽ при ставке 1,22 — 3 172 ₽ и в предложениях, и в средней", () => {
  const sheet = buildPriceSheet(prices([row("a", "Кровать", "20", { state: "few", unitPrices: [2_600], median: null, range: { from: 2_600, to: 2_600 }, n: 1 })]), null, 1.22);
  assert.deepEqual(sheet.table!.rows[0].offers, [3_172]);
  assert.equal(sheet.table!.rows[0].mean, 3_172);
  assert.equal(sheet.table!.rows[0].total, 63_440);
});

test("позиций из документов нет, а таблица заказчика есть — считается по таблице как есть; ничего нет — таблицы нет", () => {
  const sheet = buildPriceSheet(null, table);
  assert.equal(sheet.rows.length, 20);
  assert.equal(sheet.table!.total, 1_781_487.02);
  assert.equal(sheet.table!.printedTotal, 1_781_487.02);
  assert.equal(buildPriceSheet(null, null).table, null);
  assert.equal(buildPriceSheet(prices([row("a", "Тумба", "5")]), null).table, null);
});
