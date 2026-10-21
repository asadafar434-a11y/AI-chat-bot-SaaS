// РИЦ — расчёт индикативной цены: статистика, НДС, правила допуска цен, однородность, неполный расчёт, сравнение с начальной ценой и настоящее обоснование заказчика — npm test (без ИИ).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computePosition,
  computeRic,
  DEFAULT_SETTINGS,
  normalizeRic,
  parseAmount,
  positionsFromDocuments,
  RIC_METHOD,
  statsOf,
  type Analog,
  type RicData,
  type RicPosition,
} from "./indicative-price.ts";

const NOW = new Date(2026, 9, 21); // 21 октября 2026
const settings = { ...DEFAULT_SETTINGS, nmckVat: "without" as const };

let seq = 0;
const analog = (price: string, over: Partial<Analog> = {}): Analog => ({
  id: `a${++seq}`,
  price,
  vat: "without",
  source: "КП ООО «Север»",
  date: "2026-09-15",
  ...over,
});
const position = (analogs: Analog[], over: Partial<RicPosition> = {}): RicPosition => ({ id: `p${++seq}`, name: "Уголь", unit: "т", qty: "10", analogs, ...over });
const near = (a: number | null, b: number, eps = 1e-6) => assert.ok(a !== null && Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test("введённые числа читаются так, как их пишут: пробелы, запятая; не число — не число", () => {
  assert.equal(parseAmount("1 250,50"), 1250.5);
  assert.equal(parseAmount("8941.38"), 8941.38);
  assert.equal(parseAmount("1 000"), 1000);
  for (const bad of ["", "abc", "12abc", "-5", "1,2,3", "1e5"]) assert.equal(parseAmount(bad), null, bad);
});

test("статистика как в методике: среднее, медиана, СКО по выборке (n − 1), коэффициент вариации", () => {
  const s = statsOf([8941.38, 9835.52, 8047.24])!;
  near(s.mean, 8941.38, 1e-9);
  near(s.median, 8941.38, 1e-9);
  near(s.stdev, 894.14, 1e-9);
  near(s.cv, 0.1, 1e-4);
  assert.equal(statsOf([])?.n, undefined);
  assert.equal(statsOf([5])!.stdev, 0);
  near(statsOf([1, 2, 3, 4])!.median, 2.5);
});

test("настоящее обоснование заказчика (МУП «Тепло», уголь): три коммерческих предложения, коэффициент вариации 10 %, 2 900 т × 8 941,38 ₽ = 25 930 002 ₽ без НДС", () => {
  const p = position([analog("8941,38"), analog("9835,52"), analog("8047,24")], { name: "Уголь каменный", qty: "2 900" });
  const r = computeRic({ positions: [p], settings }, 25_930_002, NOW);
  const pos = r.positions[0];
  assert.equal(pos.status, "ok");
  near(pos.stats!.cv, 0.1, 1e-4);
  near(pos.unitNoVat, 8941.38, 1e-9);
  assert.equal(r.ric, 25_930_002);
  assert.equal(r.complete, true);
  assert.equal(r.reliable, true);
  assert.equal(r.deviation?.abs, 0);
  assert.equal(r.deviation?.pct, 0);
});

test("НДС: цена с НДС приводится к основе без НДС; итог переводится в основу начальной цены (с НДС или без)", () => {
  const p = position([analog("122", { vat: "with" }), analog("244", { vat: "with" }), analog("183", { vat: "with" })], { qty: "1" });
  const noVat = computePosition(p, { ...DEFAULT_SETTINGS, vatRate: 22, nmckVat: "without" }, NOW);
  near(noVat.unitNoVat, 150, 1e-9);
  near(noVat.unit, 150, 1e-9);
  const withVat = computePosition(p, { ...DEFAULT_SETTINGS, vatRate: 22, nmckVat: "with" }, NOW);
  near(withVat.unitNoVat, 150, 1e-9);
  near(withVat.unit, 183, 1e-9);
});

test("цена без источника, без даты, с датой в будущем, без числа и исключённая человеком в расчёт не попадает — с причиной", () => {
  const p = position([
    analog("100"),
    analog("110"),
    analog("120"),
    analog("130", { source: "  " }),
    analog("140", { date: "" }),
    analog("150", { date: "2026-12-01" }),
    analog("не цена"),
    analog("160", { excluded: true }),
  ]);
  const r = computePosition(p, settings, NOW);
  assert.equal(r.used, 3);
  assert.deepEqual(
    r.checks.filter((c) => c.state !== "used").map((c) => c.reason),
    ["не указан источник", "не указана дата", "дата в будущем", "цена не указана", "исключена вами"],
  );
  near(r.unitNoVat, 110, 1e-9);
});

test("устаревшая цена (старше настроенного срока) считается, но помечена; ровно на границе — ещё не устарела", () => {
  const p = position([analog("100"), analog("100", { date: "2026-04-24" }), analog("100", { date: "2026-04-23" })]); // 180 и 181 день до 21.10.2026
  const r = computePosition(p, settings, NOW);
  assert.equal(r.used, 3);
  assert.equal(r.staleCount, 1);
  assert.equal(computePosition(p, { ...settings, staleDays: 30 }, NOW).staleCount, 3, "срок настраивается: при 30 днях устарели все три");
});

test("меньше трёх аналогов — индикативной цены нет, а не «посчитали по двум»", () => {
  const r = computePosition(position([analog("100"), analog("120")]), settings, NOW);
  assert.equal(r.status, "insufficient");
  assert.equal(r.unit, null);
  assert.equal(r.total, null);
  assert.equal(RIC_METHOD.minAnalogs, 3);
});

test("разброс выше 33 %: позиция «неоднородна»; при четырёх аналогах и больше предлагается убрать одно, решает человек", () => {
  const four = computePosition(position([analog("100"), analog("105"), analog("110"), analog("300")]), settings, NOW);
  assert.equal(four.status, "heterogeneous");
  assert.ok(four.stats!.cv > RIC_METHOD.maxVariation);
  assert.equal(four.suggest?.analogId, four.checks[3].analog.id);
  assert.ok(four.suggest!.cv <= RIC_METHOD.maxVariation);
  assert.ok(four.unit !== null, "цена всё равно посчитана — но не считается надёжной");
  const three = computePosition(position([analog("100"), analog("105"), analog("300")]), settings, NOW);
  assert.equal(three.status, "heterogeneous");
  assert.equal(three.suggest, null, "после исключения останется два аналога — предлагать нечего, нужны ещё цены");
});

test("расчёт неполный (у позиции мало аналогов или нет количества): суммы и сравнения с начальной ценой нет, показана только частичная сумма", () => {
  const done = position([analog("100"), analog("100"), analog("100")], { qty: "5" });
  const few = position([analog("50")], { qty: "2" });
  const r = computeRic({ positions: [done, few], settings }, 1000, NOW);
  assert.equal(r.complete, false);
  assert.equal(r.ric, null);
  assert.equal(r.deviation, null);
  assert.equal(r.range, null);
  assert.equal(r.partial, 500);
  assert.equal(r.counted, 1);
  const noQty = computeRic({ positions: [position([analog("100"), analog("100"), analog("100")], { qty: "" })], settings }, 1000, NOW);
  assert.equal(noQty.complete, false);
  assert.equal(computeRic({ positions: [], settings }, 1000, NOW).complete, false);
});

test("отклонение начальной цены от РИЦ: плюс — заказчик выше; диапазон — по крайним аналогам; цена заказчика по позиции сравнивается с индикативной", () => {
  const p = position([analog("90"), analog("100"), analog("110")], { qty: "10", customerUnit: 130 });
  const r = computeRic({ positions: [p], settings }, 1300, NOW);
  assert.equal(r.ric, 1000);
  assert.deepEqual(r.range, { from: 900, to: 1100 });
  assert.equal(r.deviation?.abs, 300);
  near(r.deviation!.pct, 30, 1e-9);
  near(r.positions[0].customer!.pct, 30, 1e-9);
  const lower = computeRic({ positions: [p], settings }, 800, NOW);
  assert.equal(lower.deviation?.abs, -200);
  near(lower.deviation!.pct, -20, 1e-9);
  assert.equal(computeRic({ positions: [p], settings }, null, NOW).deviation, null);
});

test("позиции берутся из бланка заказчика «Спецификация» вместе с его начальными ценами за единицу", () => {
  const text = ["СПЕЦИФИКАЦИЯ", "№ | Наименование | Ед. изм. | Кол-во", "1 | Уголь каменный | т | 2900", "2 | Доставка | усл. | 1", "Итого"].join("\n");
  const calc = ["Расчёт цены единицы товара", "Уголь каменный | 2900 | 8941,38 | 25930002,00", "Доставка | 1 | 1000,00 | 1000,00"].join("\n");
  const found = positionsFromDocuments([{ name: "Спецификация.docx", text }, { name: "Расчёт.xlsx", text: calc }])!;
  assert.equal(found.positions.length, 2);
  assert.equal(found.positions[0].name, "Уголь каменный");
  assert.equal(found.positions[0].qty, "2900");
  assert.equal(found.positions[0].customerUnit, 8941.38);
  assert.equal(positionsFromDocuments([{ name: "x", text: "Просто текст" }]), null);
});

test("данные из хранилища: что не понято — отбрасывается, ставка и основа НДС берутся из настроек, неверные заменяются безопасными", () => {
  const data = normalizeRic({
    settings: { vatRate: 500, nmckVat: "странно", staleDays: -3 },
    positions: [
      { id: "p1", name: "Кран", unit: "шт", qty: "2", analogs: [{ id: "a", price: "5", vat: "without", source: "КП", date: "2026-01-01", excluded: true }, "мусор", { price: "1" }], customerUnit: 5 },
      { name: "без id" },
      "мусор",
    ],
  });
  assert.deepEqual(data.settings, DEFAULT_SETTINGS);
  assert.equal(data.positions.length, 1);
  assert.equal(data.positions[0].analogs.length, 1);
  assert.equal(data.positions[0].analogs[0].excluded, true);
  assert.equal(data.positions[0].customerUnit, 5);
  assert.deepEqual(normalizeRic(null), { positions: [], settings: DEFAULT_SETTINGS });
  const empty: RicData = normalizeRic(undefined);
  assert.equal(empty.positions.length, 0);
});
