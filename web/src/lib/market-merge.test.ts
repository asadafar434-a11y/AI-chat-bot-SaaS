// Цены общей базы в расчёте закупки: запрос по позициям, добавление цен-аналогов в памяти, строки для подсказки — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type RicData } from "./indicative-price.ts";
import { marketLines, marketRequestOf, withMarketAnalogs, type MarketResultLite } from "./market-merge.ts";
import type { MarketStats } from "./market-observations.ts";

const data = (): RicData => ({
  settings: DEFAULT_SETTINGS,
  positions: [
    { id: "p1", name: "Уголь каменный ДПК", unit: "т", qty: "1 500,5", analogs: [{ id: "own-1", price: "5000", vat: "without", source: "мой прайс", date: "2026-09-01" }] },
    { id: "p2", name: "Сахар песок", unit: "т", qty: "", analogs: [] },
    { id: "p3", name: "x", unit: "шт", qty: "5", analogs: [] },
  ],
});
const stats = (over: Partial<MarketStats> = {}): MarketStats => ({ status: "ok", n: 6, mean: 5050, median: 5000, range: { from: 4800, to: 5300 }, cv: 0.04, dynamics: null, regional: [], targetRegion: null, sources: [], dates: null, missing: [], ...over });
const analog = (price: string, date: string, source: string, id: string) => ({ id, price, vat: "without" as const, source, date });

test("запрос к базе: позиции расчёта с названием, единицей, количеством и регионом; без названия и пустое количество не уходят", () => {
  const req = marketRequestOf(data(), "Севастополь");
  assert.deepEqual(req.positions, [
    { key: "p1", name: "Уголь каменный ДПК", unit: "т", quantity: 1500.5, region: "Севастополь" },
    { key: "p2", name: "Сахар песок", unit: "т", region: "Севастополь" },
  ]);
  assert.deepEqual(marketRequestOf(data(), null).positions[0], { key: "p1", name: "Уголь каменный ДПК", unit: "т", quantity: 1500.5 });
});

test("цены базы добавляются к аналогам позиции в памяти: свои — первыми, повторы не дублируются, исходные данные не меняются", () => {
  const original = data();
  const merged = withMarketAnalogs(original, [
    { key: "p1", stats: stats(), analogs: [analog("5000", "2026-09-01", "мой прайс", "market-1"), analog("5100", "2026-08-01", "База цен: прайс поставщика № 1", "market-2")] },
  ]);
  assert.equal(merged.positions[0].analogs.length, 2, "цена, которая уже введена, второй раз не добавляется");
  assert.equal(merged.positions[0].analogs[0].id, "own-1");
  assert.equal(merged.positions[0].analogs[1].id, "p1-market-2", "у цены базы уникальный номер внутри позиции");
  assert.equal(merged.positions[0].analogs[1].source, "База цен: прайс поставщика № 1");
  assert.equal(original.positions[0].analogs.length, 1, "исходный расчёт не изменён");
  assert.equal(merged.positions[1], original.positions[1], "позиция без цен базы — тот же объект");
});

test("базы нет или она ничего не дала — расчёт остаётся прежним (тот же объект)", () => {
  const d = data();
  assert.equal(withMarketAnalogs(d, []), d);
  assert.equal(withMarketAnalogs(d, [{ key: "p1", stats: stats({ status: "insufficient", median: null, range: null }), analogs: [] }]).positions[0].analogs.length, 1);
  assert.equal(withMarketAnalogs(d, [{ key: "нет такой", stats: stats(), analogs: [analog("1", "2026-01-01", "x", "m")] }]).positions[0].analogs.length, 1);
});

test("строки для подсказки: медиана, диапазон, число цен, динамика и регион — только где данных хватило; осторожные выводы помечены", () => {
  const results: MarketResultLite[] = [
    { key: "p1", stats: stats({ dynamics: { changePct: 4.2, recent: { n: 3, median: 5200 }, earlier: { n: 3, median: 5000 } }, targetRegion: { region: "Севастополь", n: 4, median: 5400, diffPct: 8 } }), analogs: [] },
    { key: "p2", stats: stats({ status: "insufficient", median: null, range: null, n: 2 }), analogs: [] },
    { key: "p3", stats: stats({ status: "heterogeneous" }), analogs: [] },
  ];
  const lines = marketLines(data(), results).map((l) => l.replace(/[  ]/g, " "));
  assert.equal(lines.length, 2, "позиция без данных молчит");
  assert.match(lines[0], /^«Уголь каменный ДПК»: медиана 5 000 ₽, диапазон 4 800 ₽ – 5 300 ₽, цен 6, динамика \+4,2 % к прежним ценам, в регионе закупки \+8 % к общей медиане$/);
  assert.match(lines[1], /цены неоднородны$/);
});
