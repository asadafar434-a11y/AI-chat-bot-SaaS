// Таблица «Сколько стоит исполнение» из закупочных цен в интернете — когда у заказчика таблицы цен нет — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { executionCost } from "./execution-cost.ts";
import { internetPriceTable } from "./internet-price-table.ts";
import type { PositionPriceRow, PositionPrices } from "./position-prices.ts";

const row = (id: string, name: string, qty: string, over: Partial<PositionPriceRow> = {}): PositionPriceRow => ({
  id, name, unit: "шт", qty, customerUnit: null, state: "none", median: null, range: null, n: 0, gapPct: null, sources: [], cost: null, unitPrices: [], analogs: null, ...over,
});
const prices = (rows: PositionPriceRow[]): PositionPrices => ({ rows, priced: 0, cost: null, costPositions: 0, asOf: "2026-10-29" });
const exact = (p: number[]): Partial<PositionPriceRow> => ({ state: "found", unitPrices: p, median: p[Math.floor(p.length / 2)], range: { from: p[0], to: p[p.length - 1] }, n: p.length });

test("точные цены: минимум, медиана и максимум по найденным ценам × количество; аналоги — диапазон; цена заказчика — когда в интернете нет", () => {
  const t = internetPriceTable(
    prices([
      row("a", "Тумба", "50", exact([7_454, 9_500, 9_700])),
      row("b", "Стол на 8 мест", "2", { analogs: { n: 5, range: { from: 11_000, to: 16_000 }, sources: [] } }),
      row("c", "Шкаф", "10", { customerUnit: 12_000 }),
    ]),
  )!;
  assert.deepEqual(t.internet, { found: 1, analogs: 1, filled: 1, missing: 0 });
  assert.equal(t.rows.length, 3);
  const c = executionCost(t, 1_000_000);
  assert.equal(c.min, 7_454 * 50 + 11_000 * 2 + 12_000 * 10, "минимум: низшая цена тумбы, нижняя граница аналогов, цена заказчика");
  assert.equal(c.mean, 9_500 * 50 + 13_500 * 2 + 12_000 * 10, "средняя: медиана, середина аналогов, цена заказчика");
  assert.equal(c.max, 9_700 * 50 + 16_000 * 2 + 12_000 * 10);
  assert.notEqual(c.verdict.title, "Цен найдено не по всем позициям");
});

test("позиция без цены и без цены заказчика — итог неполный, вывод «можно» не делается", () => {
  const t = internetPriceTable(prices([row("a", "Тумба", "50", exact([7_000, 8_000, 9_000])), row("b", "Комод", "15")]))!;
  assert.equal(t.internet!.missing, 1);
  assert.equal(executionCost(t, 2_000_000).verdict.title, "Цен найдено не по всем позициям");
  assert.match(executionCost(t, 2_000_000).verdict.text, /по 1 позиции цены нет ни в интернете, ни у заказчика/);
});

test("цены без НДС пересчитываются в основу начальной цены; нет количества — позиция без цены; ничего не найдено — таблицы нет", () => {
  const t = internetPriceTable(prices([row("a", "Тумба", "10", exact([1_000, 1_000, 1_000])), row("b", "Кресло", "", exact([5_000]))]), 1.22)!;
  assert.equal(t.rows.length, 1);
  assert.equal(t.rows[0].mean, 1_220);
  assert.equal(t.internet!.missing, 1);
  assert.equal(internetPriceTable(prices([row("a", "Тумба", "10")])), null);
  assert.equal(internetPriceTable(null), null);
});
