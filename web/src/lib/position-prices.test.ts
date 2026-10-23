import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type RicData } from "./indicative-price.ts";
import { makeObservation, type Observation } from "./market-observations.ts";
import { positionPrices } from "./position-prices.ts";
import type { SavedPrices } from "./price-cache.ts";

const obs = (price: number, host: string, name = "Уголь каменный ДПК", tail = `; https://${host}/price`): Observation => {
  const built = makeObservation({ name, unit: "т", price, vat: "without", vatRate: 22, date: "2026-10-20", source: `${host}: каталог — страница, проверено 20.10.2026${tail}`, sourceKind: "supplier_offer" });
  if (!built.ok) throw new Error(built.reason);
  return built.value;
};

const data = (over: Partial<RicData["positions"][number]> = {}): RicData => ({
  positions: [{ id: "p1", name: "Уголь каменный ДПК", unit: "т", qty: "1 500", analogs: [], customerUnit: 6100, ...over }],
  settings: { ...DEFAULT_SETTINGS, nmckVat: "without" },
});
const saved = (observations: Observation[]): SavedPrices => ({ at: "2026-10-22T10:00:00.000Z", signature: "s", results: [{ key: "p1", observations, pagesRead: observations.length, rejected: 0 }], spentRub: 2 });
const FIVE = [5000, 5050, 5100, 5150, 5200].map((p, i) => obs(p, `shop${i + 1}.ru`));

test("цен хватает (от пяти): медиана, диапазон, число цен, закупочная стоимость позиции и отличие начальной цены заказчика", () => {
  const r = positionPrices(data(), saved(FIVE), ["p1"], "done", "2026-10-22");
  const row = r.rows[0];
  assert.equal(row.state, "found");
  assert.equal(row.median, 5100);
  assert.equal(row.n, 5);
  assert.deepEqual(row.range, { from: 5000, to: 5200 });
  assert.equal(row.cost, 7_650_000, "5 100 ₽ × 1 500 т");
  assert.ok(Math.abs(row.gapPct! - 19.6) < 0.1, `заказчик заложил на 19,6 % больше закупки, получилось ${row.gapPct}`);
  assert.equal(r.priced, 1);
  assert.equal(r.cost, 7_650_000);
  assert.equal(r.costPositions, 1);
  assert.equal(r.asOf, "2026-10-20");
});

test("основа НДС заказчика: начальная цена с НДС сравнивается с закупочной медианой, пересчитанной на НДС", () => {
  const withVat: RicData = { ...data(), settings: { ...DEFAULT_SETTINGS, nmckVat: "with", vatRate: 20 } };
  const row = positionPrices(withVat, saved(FIVE), ["p1"], "done", "2026-10-22").rows[0];
  assert.ok(Math.abs(row.gapPct! - ((6100 - 6120) / 6120) * 100) < 0.01, "5 100 × 1,2 = 6 120");
});

test("цен мало (меньше пяти): показаны найденные, медианы и стоимости нет — вывод не делается", () => {
  const row = positionPrices(data(), saved(FIVE.slice(0, 3)), ["p1"], "done", "2026-10-22").rows[0];
  assert.equal(row.state, "few");
  assert.equal(row.median, null);
  assert.equal(row.cost, null);
  assert.equal(row.gapPct, null);
  assert.equal(row.n, 3);
  assert.deepEqual(row.range, { from: 5000, to: 5100 });
  assert.equal(row.sources.length, 3);
});

test("не искали, ищем, выключен, не удалось, ничего не нашли: у позиции состояние без цен и без выдуманных чисел", () => {
  const states = (searched: string[], state: Parameters<typeof positionPrices>[3], s: SavedPrices | null) => positionPrices(data(), s, searched, state, "2026-10-22").rows[0];
  assert.equal(states([], "done", saved(FIVE)).state, "not-searched", "позиция не вошла в три главные");
  assert.equal(states(["p1"], "searching", null).state, "searching");
  assert.equal(states(["p1"], "off", null).state, "off");
  assert.equal(states(["p1"], "failed", null).state, "failed");
  const none = states(["p1"], "done", saved([]));
  assert.equal(none.state, "none");
  assert.equal(none.median, null);
  assert.equal(none.sources.length, 0);
  assert.equal(positionPrices(data(), saved([]), ["p1"], "done", "2026-10-22").priced, 0);
  assert.equal(positionPrices(data(), saved([]), ["p1"], "done", "2026-10-22").cost, null);
});

test("несопоставимые цены не показываются: другой товар и другая единица в расчёт не идут", () => {
  const other = obs(900, "other.ru", "Щебень гранитный фракция 5-20");
  const row = positionPrices(data(), saved([...FIVE, other]), ["p1"], "done", "2026-10-22").rows[0];
  assert.equal(row.n, 5);
  assert.ok(row.sources.every((s) => !/Щебень/.test(s.product)));
});

test("источники: до трёх цен, ближайших к медиане, с поставщиком, датой и ссылкой; ссылка не http(s) отбрасывается", () => {
  const withBad = [...FIVE.slice(0, 4), obs(5200, "bad.ru", "Уголь каменный ДПК", "; javascript:alert(1)")];
  const row = positionPrices(data(), saved(withBad), ["p1"], "done", "2026-10-22").rows[0];
  assert.equal(row.sources.length, 3);
  assert.deepEqual(row.sources[0], { host: "shop3.ru", product: "Уголь каменный ДПК", price: 5100, date: "2026-10-20", url: "https://shop3.ru/price" });
  const bad = positionPrices(data(), saved([obs(5200, "bad.ru", "Уголь каменный ДПК", "; javascript:alert(1)")]), ["p1"], "done", "2026-10-22").rows[0];
  assert.equal(bad.sources[0].url, null);
});

test("количества нет — стоимость позиции не считается; несколько позиций — стоимость только по тем, где есть цена и количество", () => {
  assert.equal(positionPrices(data({ qty: "" }), saved(FIVE), ["p1"], "done", "2026-10-22").rows[0].cost, null);
  const two: RicData = { ...data(), positions: [...data().positions, { id: "p2", name: "Кокс", unit: "т", qty: "10", analogs: [] }] };
  const r = positionPrices(two, saved(FIVE), ["p1", "p2"], "done", "2026-10-22");
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[1].state, "none");
  assert.equal(r.costPositions, 1);
  assert.equal(r.cost, 7_650_000);
});
