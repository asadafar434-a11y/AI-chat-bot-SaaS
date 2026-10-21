// Ценовой бейдж: четыре статуса, пять сопоставимых цен как минимум, двойное условие «вне диапазона и не меньше порога», настраиваемый порог — npm test (без ИИ).
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeRic, DEFAULT_SETTINGS, type Analog, type RicData, type RicPosition } from "./indicative-price.ts";
import { BADGE_TITLES, priceBadge } from "./price-badge.ts";

const NOW = new Date(2026, 9, 21);
let seq = 0;
const analog = (price: number, over: Partial<Analog> = {}): Analog => ({ id: `a${++seq}`, price: String(price), vat: "without", source: `КП ${seq}`, date: "2026-09-15", ...over });
// Пять цен около 100: средняя 100, вариация около 7,9 %, диапазон 90–110.
const five = (...prices: number[]) => (prices.length ? prices : [90, 95, 100, 105, 110]).map((p) => analog(p));
const pos = (analogs: Analog[], over: Partial<RicPosition> = {}): RicPosition => ({ id: `p${++seq}`, name: "Уголь", unit: "т", qty: "10", analogs, ...over });
const data = (positions: RicPosition[], over: Partial<RicData["settings"]> = {}): RicData => ({ positions, settings: { ...DEFAULT_SETTINGS, nmckVat: "without", ...over } });
const badge = (d: RicData, nmck: number | null) => priceBadge(computeRic(d, nmck, NOW), d);

test("пять цен, начальная цена вдвое выше диапазона аналогов — «существенно выше рынка», с деталями для проверки", () => {
  const b = badge(data([pos(five())]), 2000); // РИЦ 1000, диапазон 900–1100
  assert.equal(b.status, "above");
  assert.equal(b.title, "Цена существенно выше рынка");
  assert.equal(b.detail?.abs, 1000);
  assert.equal(b.detail?.pct, 100);
  assert.deepEqual(b.detail?.range, { from: 900, to: 1100 });
  assert.equal(b.detail?.median, 1000);
  assert.deepEqual(b.detail?.observations, { min: 5, total: 5 });
  assert.deepEqual(b.detail?.dates, { from: "2026-09-15", to: "2026-09-15" });
  assert.equal(b.detail?.sources.length, 5);
  assert.equal(b.detail?.confidence, "medium", "пять цен — средняя уверенность");
});

test("«существенно ниже рынка» — начальная цена ниже диапазона и ниже РИЦ не меньше чем на порог", () => {
  assert.equal(badge(data([pos(five())]), 500).status, "below");
});

test("в диапазоне цен-аналогов бейдж «в рынке», даже если отклонение от среднего больше порога; близко к РИЦ, но вне диапазона — тоже «в рынке»", () => {
  const wide = data([pos(five(60, 90, 100, 110, 140))]); // среднее 100, диапазон 600–1400
  assert.equal(badge(wide, 1350).status, "within", "+35 % от РИЦ, но внутри диапазона аналогов");
  assert.equal(badge(data([pos(five())]), 1050).status, "within");
  assert.equal(badge(data([pos(five())]), 1120).status, "within", "вне диапазона (до 1100), но отклонение 12 % меньше порога 15 %");
  assert.equal(badge(data([pos(five())]), 1150).status, "above", "ровно порог 15 % и вне диапазона — «выше»");
});

test("порог существенного отклонения — настройка: при 30 % те же цифры дают «в рынке»", () => {
  assert.equal(badge(data([pos(five())], { badgePct: 30 }), 1200).status, "within");
  assert.equal(badge(data([pos(five())], { badgePct: 10 }), 1200).status, "above");
});

test("меньше пяти сопоставимых цен у любой позиции — «недостаточно данных» и что именно не хватает; бейджа «выше рынка» нет", () => {
  const b = badge(data([pos(five()), pos([analog(10), analog(10), analog(10), analog(10)], { name: "Доставка" })]), 99_999);
  assert.equal(b.status, "insufficient");
  assert.equal(b.title, BADGE_TITLES.insufficient);
  assert.equal(b.detail, null);
  assert.deepEqual(b.missing, ["«Доставка»: сопоставимых цен 4, нужно не меньше 5."]);
});

test("неоднородные цены, неполный расчёт, нет начальной цены, нет позиций — «недостаточно данных» с причиной", () => {
  const wild = badge(data([pos(five(10, 100, 200, 300, 900))]), 2000);
  assert.equal(wild.status, "insufficient");
  assert.match(wild.missing[0], /цены неоднородны/);
  assert.match(badge(data([pos(five())]), null).missing[0], /Не указана начальная цена/);
  assert.match(badge(data([pos(five(), { qty: "" })]), 1000).missing[0], /не у всех позиций: у 0 из 1/);
  assert.deepEqual(badge(data([]), 1000).missing, ["Нет позиций закупки."]);
});

test("причин много — показаны первые три и «и ещё»", () => {
  const few = (n: string) => pos([analog(1)], { name: n });
  const b = badge(data([few("А"), few("Б"), few("В"), few("Г")]), 1000);
  assert.equal(b.missing.length, 4);
  assert.match(b.missing[3], /и ещё/);
});

test("уверенность «высокая»: по каждой позиции не меньше восьми цен, вариация до 20 % и нет устаревших", () => {
  const eight = [95, 97, 99, 100, 100, 101, 103, 105].map((p) => analog(p));
  assert.equal(badge(data([pos(eight)]), 2000).detail?.confidence, "high");
  const stale = [...eight.slice(0, 7), analog(105, { date: "2025-01-01" })];
  assert.equal(badge(data([pos(stale)]), 2000).detail?.confidence, "medium", "одна устаревшая цена — уверенность средняя");
});

test("начальная цена с НДС: РИЦ переводится в её основу, и бейдж считается в одной системе", () => {
  const d = data([pos(five())], { nmckVat: "with", vatRate: 20 }); // РИЦ с НДС = 1200
  assert.equal(badge(d, 1200).status, "within");
  assert.equal(badge(d, 2400).status, "above");
});
