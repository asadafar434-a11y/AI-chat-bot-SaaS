// Сравнение цен заказчика с ценами в интернете: сопоставление позиций со строками таблицы обоснования, разница по позициям — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { findCustomerPriceTable } from "./customer-price-table.ts";
import { BRATSK } from "./customer-price-table.fixture.ts";
import type { RicPosition } from "./indicative-price.ts";
import type { PositionPriceRow, PositionPrices } from "./position-prices.ts";
import { comparePrices, dropImplausible, tableBounds, matchTableRows, withTablePrices } from "./price-compare.ts";

const table = findCustomerPriceTable([{ name: "Извещение .docx", text: BRATSK }])!;
// Позиции так, как их берёт из описания объекта закупки код (goods-table.ts): полные названия и количество.
const NAMES: [string, string][] = [
  ["Офисное кресло Chairman 696 LT Россия TW-01", "7"],
  ["Стол прямоугольный на 8 рабочих мест", "1"],
  ["Стол квадратный на 8 рабочих мест", "1"],
  ["Стол прямоугольный на 1 рабочее место, с настольной полкой", "1"],
  ["Стол прямоугольный, раскладной", "1"],
  ["Стол рабочий, с выкатной тумбой", "1"],
  ["Стол рабочий, с выкатной тумбой", "1"],
  ["Полка настенная, скрытого монтажа", "7"],
  ["Полка настенная, скрытого монтажа", "6"],
  ["Полка настенная, скрытого монтажа", "4"],
  ["Полка настенная, скрытого монтажа", "1"],
  ["Кровать односпальная с металлическим основанием", "20"],
  ["Комод", "15"],
  ["Тумба с выдвижным ящиком и дверцей", "50"],
  ["Тумба медицинская физиотерапевтическая MD ТМ 13.08", "6"],
  ["Стул", "20"],
  ["Деревянный стул со спинкой белого цвета INGOLF от DecoLine", "4"],
  ["Диван", "1"],
  ["Офисный диван 3-х местный", "2"],
  ["Офисный диван 3-х местный", "2"],
];
const positions: RicPosition[] = NAMES.map(([name, qty], i) => ({ id: `doc-${i + 1}`, name, unit: "шт", qty, analogs: [] }));

test("позиции сопоставляются со строками таблицы заказчика: по виду, словам и количеству — все 20, полки — по количеству", () => {
  const m = matchTableRows(positions, table.rows);
  assert.equal(m.size, 20);
  assert.equal(m.get("doc-1")!.name, "Офисное кресло");
  assert.equal(m.get("doc-4")!.name, "Стол прямоугольный с настольной полкой");
  assert.deepEqual(["doc-8", "doc-9", "doc-10", "doc-11"].map((id) => m.get(id)!.name), ["Полка настенная 100 см", "Полка настенная 80 см", "Полка настенная 60 см", "Полка настенная 40 см"]);
  assert.equal(m.get("doc-17")!.name, "Деревянный стул со спинкой");
  assert.equal(m.get("doc-19")!.name, "Офисный диван 3-х местный (зеленый)");
});

test("другой вид товара не сопоставляется, даже если строк столько же", () => {
  const m = matchTableRows([{ id: "x", name: "Холодильник двухкамерный", qty: "3" }], table.rows.slice(0, 1));
  assert.equal(m.size, 0);
});

test("цена заказчика за единицу из таблицы — у позиций без своей; своя не затирается", () => {
  const out = withTablePrices([{ ...positions[0], customerUnit: 7000 }, positions[11]], table);
  assert.equal(out[0].customerUnit, 7000);
  assert.equal(out[1].customerUnit, 22010.67);
  assert.equal(withTablePrices(positions, null), positions);
});

const row = (id: string, name: string, over: Partial<PositionPriceRow>): PositionPriceRow => ({
  id, name, unit: "шт", qty: "1", customerUnit: null, state: "none", median: null, range: null, n: 0, gapPct: null, sources: [], cost: null, unitPrices: [], analogs: null, ...over,
});

test("сравнение: точная цена и аналог против цен поставщиков заказчика; разница от средней; дорогие позиции первыми; цены без НДС пересчитаны на НДС заказчика", () => {
  const prices: PositionPrices = {
    rows: [
      row("doc-1", NAMES[0][0], { qty: "7", state: "few", range: { from: 5223.8, to: 5223.8 }, n: 1, sources: [{ host: "o-manager.ru", product: "Chairman 696", price: 5223.8, date: "2026-10-29", url: null }] }),
      row("doc-4", NAMES[3][0], { analogs: { n: 5, range: { from: 11150, to: 16268 }, sources: [{ host: "dobro.io", product: "Стол 120х60", price: 13300, date: "2026-10-29", url: null }] } }),
      row("doc-12", NAMES[11][0], { qty: "20" }),
    ],
    priced: 0, cost: null, costPositions: 0, asOf: "2026-10-29",
  };
  const c = comparePrices(prices, table, 1);
  assert.equal(c.rows.length, 2, "кровать без цены в интернете в сравнение не идёт");
  assert.equal(c.exact, 1);
  assert.equal(c.analog, 1);
  const [chair, desk] = c.rows;
  assert.equal(chair.name, NAMES[0][0], "кресло дороже по сумме (7 × 6 905) — первым");
  assert.deepEqual(chair.customer, { min: 5510, mean: 6905.07, max: 8300 });
  assert.equal(chair.web.kind, "exact");
  assert.equal(chair.diffPct, -24.3);
  assert.equal(chair.where, "below", "в интернете дешевле самого дешёвого поставщика заказчика");
  assert.equal(desk.web.kind, "analog");
  assert.equal(desk.web.mid, (11150 + 16268) / 2);
  assert.equal(desk.where, "inside");
  assert.equal(c.exactDiffPct, -24.3);
  const withVat = comparePrices(prices, table, 1.22);
  assert.equal(Math.round(withVat.rows[0].web.mid * 100) / 100, Math.round(5223.8 * 1.22 * 100) / 100);
});

test("правдоподобие: цена в 3 раза ниже самой низкой у заказчика отбрасывается, в 2–3 раза — остаётся с пометкой «проверьте»", () => {
  const bounds = tableBounds(positions, table);
  assert.deepEqual(bounds.get("doc-12"), { min: 19_642, max: 24_390 }, "кровать: от самой низкой до самой высокой у заказчика");
  const o = (p: number) => ({ priceNoVat: p });
  const saved = { results: [{ key: "doc-12", observations: [o(7_040), o(5_000), o(21_000), o(80_000)] }, { key: "нет-в-таблице", observations: [o(1)] }] };
  const out = dropImplausible(saved, bounds);
  assert.deepEqual(out.results[0].observations.map((x) => x.priceNoVat), [7_040, 21_000], "5 000 и 80 000 — не тот товар; 7 040 (в 2,8 раза ниже) остаётся");
  assert.equal(out.dropped, 2);
  assert.equal(out.results[1].observations.length, 1, "позиция без строки в таблице заказчика не трогается");
  assert.equal(dropImplausible(saved, new Map()).dropped, 0);
  assert.equal(dropImplausible({ results: [{ key: "doc-12", observations: [o(20_000)] }] }, bounds, 1.22).dropped, 0, "с НДС 22 % та же цена тоже в порядке");

  const prices: PositionPrices = {
    rows: [row("doc-12", NAMES[11][0], { qty: "20", state: "few", range: { from: 7_040, to: 7_040 }, n: 1, sources: [{ host: "a.ru", product: "Кровать", price: 7_040, date: "2026-10-29", url: null }] }), row("doc-14", NAMES[13][0], { qty: "50", state: "few", range: { from: 8_000, to: 8_000 }, n: 1, sources: [{ host: "b.ru", product: "Тумба", price: 8_000, date: "2026-10-29", url: null }] })],
    priced: 0, cost: null, costPositions: 0, asOf: "2026-10-29",
  };
  const c = comparePrices(prices, table, 1);
  assert.deepEqual(c.rows.map((r) => [r.id, r.suspicious]), [["doc-14", false], ["doc-12", true]]);
});
