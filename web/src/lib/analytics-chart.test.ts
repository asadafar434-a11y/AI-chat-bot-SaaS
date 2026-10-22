// Итоговая диаграмма: из чего складывается цена, риски в процентах от цены, прибыль при снижении цены, проценты для карточек — из уже посчитанного — npm test (без ИИ).
import assert from "node:assert/strict";
import { test } from "node:test";
import { chartFacts, compactRub, niceTicks, priceBar, profitCurve, riskShares } from "./analytics-chart.ts";
import { contractRisks } from "./contract-risks.ts";
import { DEFAULT_ECON, economics } from "./economics.ts";
import { computeRic, DEFAULT_SETTINGS, EMPTY_RIC, type RicData } from "./indicative-price.ts";
import type { PriceCalc } from "./price-floor.ts";
import { DEFAULT_ASSUMPTIONS, estimateRisks } from "./risk-estimate.ts";

const NOW = new Date("2026-10-21T12:00:00Z");
const CALC: PriceCalc = {
  nmck: 1_000_000,
  costs: 600_000,
  extra: 10_000,
  taxPct: 6,
  securityPct: 5,
  smeOnly: false,
  exempt: false,
  method: "guarantee",
  guaranteeRatePct: null,
  moneyRatePct: null,
  days: null,
  antiDumping: false,
  goodFaith: false,
  price: null,
};
const LINES = [
  "7.3. Исполнитель обязан уплатить Заказчику пеню в размере 0,1% от цены Договора за каждый день просрочки.",
  "3.6. Оплата производится Заказчиком в течение 30 дней с даты акта.",
  "10.1. Договор заключается после предоставления Исполнителем обеспечения исполнения Договора в размере 5 % от цены.",
  "2.1. Цена Договора является твёрдой и определяется на весь срок исполнения Договора.",
  "5.12. Расходы на экспертизу несёт Исполнитель, за исключением случаев, когда экспертизой установлено отсутствие нарушений.",
  "4.2. Заказчик вправе изменить объём поставки не более чем на 10 % от цены Договора.",
];
const estimateOf = (lines = LINES) =>
  estimateRisks({ price: 1_000_000, risks: contractRisks([{ name: "Проект.docx", text: ["Договор поставки № 1", ...lines].join("\n") }]), type: "goods", region: null, assumptions: DEFAULT_ASSUMPTIONS });
const econOf = (calc: Partial<PriceCalc> = {}, price: number | null = null, lines = LINES) => economics({ calc: { ...CALC, ...calc }, estimate: estimateOf(lines), settings: DEFAULT_ECON, price });
const near = (a: number, b: number, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test("полоса цены: части идут затраты → налог и обеспечение → риски → прибыль и в сумме дают цену", () => {
  const bar = priceBar(econOf(), "base")!;
  assert.deepEqual(bar.parts.map((p) => p.id), ["costs", "taxes", "risks", "profit"]);
  near(bar.parts.reduce((sum, p) => sum + p.amount, 0), bar.price);
  near(bar.total, 1_000_000, 0.05);
  near(bar.parts.reduce((sum, p) => sum + p.pct, 0), 100, 0.01);
  assert.equal(bar.loss, null);
  assert.equal(bar.priceAt, null);
  assert.equal(bar.parts[0].label, "Ваши затраты");
  near(bar.parts[0].amount, 610_000, 0.01);
  assert.ok(bar.parts[0].items.some((i) => i.label === "Расходы на участие"));
  assert.ok(bar.parts[2].items.some((i) => i.label === "Проценты за деньги до оплаты"));
  near(bar.profitPct, bar.parts[3].pct, 0.01);
});

test("три сценария: в стрессовом затраты и риски больше и есть неустойка, в оптимистичном затраты меньше", () => {
  const econ = econOf();
  const [opt, base, stress] = (["optimistic", "base", "stress"] as const).map((s) => priceBar(econ, s)!);
  const part = (bar: typeof base, id: string) => bar.parts.find((p) => p.id === id)!;
  assert.ok(part(opt, "costs").amount < part(base, "costs").amount);
  assert.ok(part(stress, "costs").amount > part(base, "costs").amount);
  assert.ok(part(stress, "risks").amount > part(base, "risks").amount);
  assert.ok(part(stress, "risks").items.some((i) => i.label === "Неустойка (один случай)"));
  assert.ok(!part(base, "risks").items.some((i) => i.label.startsWith("Неустойка")));
  for (const bar of [opt, base, stress]) near(bar.total, bar.price, 0.05);
  assert.ok(opt.profit > base.profit && base.profit > stress.profit);
});

test("убыток: прибыльной части нет, полоса длиннее цены на сумму убытка, метка цены стоит внутри полосы", () => {
  const econ = econOf({ costs: 950_000 });
  const bar = priceBar(econ, "base")!;
  assert.ok(bar.profit < 0);
  assert.ok(!bar.parts.some((p) => p.id === "profit"));
  assert.ok(bar.loss);
  near(bar.loss!.amount, -bar.profit, 0.01);
  near(bar.loss!.pct, (-bar.profit / bar.price) * 100, 0.001);
  near(bar.total, bar.price + bar.loss!.amount, 0.05);
  assert.ok(bar.priceAt! > 50 && bar.priceAt! < 100);
  near(bar.priceAt!, (bar.price / bar.total) * 100, 0.001);
});

test("цена заявки ниже начальной: доли считаются от неё, а не от начальной", () => {
  const bar = priceBar(econOf({}, 800_000), "base")!;
  assert.equal(bar.price, 800_000);
  near(bar.parts.reduce((sum, p) => sum + p.pct, 0), 100, 0.01);
  near(bar.total, 800_000, 0.05);
});

test("нет затрат или начальной цены — полосы и кривой нет", () => {
  const noCosts = econOf({ costs: null });
  assert.equal(priceBar(noCosts, "base"), null);
  assert.equal(profitCurve(noCosts), null);
  assert.equal(priceBar(econOf({ nmck: null }), "stress"), null);
});

test("риски: от большего к меньшему, доли от цены, объём не в списке, без суммы — с тем, что запросить", () => {
  const shares = riskShares(estimateOf());
  const amounts = shares.shown.map((s) => s.amount);
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
  assert.ok(shares.shown.length >= 3);
  near(shares.shown[0].pct, (shares.shown[0].amount / 1_000_000) * 100, 0.001);
  assert.ok(!shares.shown.some((s) => s.id === "volume"));
  assert.ok(shares.unknown.some((u) => /экспертиза/i.test(u.title) && u.ask.length > 0));
  near(shares.shown.reduce((sum, s) => sum + s.amount, 0) + shares.rest.amount, shares.total, 0.05);
  assert.equal(shares.rest.count, 0);
});

test("риски: когда не помещаются в список, остаток считается числом и суммой", () => {
  const shares = riskShares(estimateOf(), 2);
  assert.equal(shares.shown.length, 2);
  assert.ok(shares.rest.count >= 1);
  near(shares.shown.reduce((sum, s) => sum + s.amount, 0) + shares.rest.amount, shares.total, 0.05);
});

test("риски: цены нет — нечего показывать, без выдуманных сумм", () => {
  const none = riskShares(estimateRisks({ price: null, risks: [], type: "goods", region: null, assumptions: DEFAULT_ASSUMPTIONS }));
  assert.deepEqual(none.shown, []);
  assert.equal(none.total, 0);
  assert.equal(none.totalPct, null);
});

test("кривая: точки из таблицы снижения, цена заявки на графике, цены «не ниже / безопасная / целевая» со снижением от начальной", () => {
  const curve = profitCurve(econOf())!;
  assert.deepEqual(curve.points.map((p) => p.drop), [0, 5, 10, 15, 20, 25, 30]);
  assert.equal(curve.currentDrop, 0);
  assert.deepEqual(curve.marks.map((m) => m.id), ["min", "safe", "target"]);
  const target = curve.marks.find((m) => m.id === "target")!;
  near(target.drop, (1 - target.price / 1_000_000) * 100, 0.001);
  assert.ok(curve.points[0].base > curve.points[0].stress);
});

test("кривая: цена за краем графика не рисуется; недостижимая цена в списке не показывается", () => {
  assert.equal(profitCurve(econOf({}, 600_000))!.currentDrop, null);
  assert.equal(profitCurve(econOf({}, 900_000))!.currentDrop, 10);
  const hard = profitCurve(econOf({ costs: 840_000 }))!;
  assert.deepEqual(hard.marks.map((m) => m.id), ["min"]);
});

test("проценты для карточек: рентабельность, снижение цены, риски к цене; РИЦ — только когда расчёт полный", () => {
  const econ = econOf({}, 900_000);
  const estimate = estimateOf();
  const facts = chartFacts({ econ, estimate, ric: null });
  assert.deepEqual(facts.map((f) => f.id), ["margin", "drop", "risks"]);
  const drop = facts.find((f) => f.id === "drop")!;
  assert.equal(drop.value.replace(/\s/g, " "), "10,0 %");
  assert.match(facts.find((f) => f.id === "risks")!.value, /^до \d+,\d\s%$/);
  const analog = (id: string, price: string) => ({ id, price, vat: "without" as const, source: "Прайс поставщика", date: "2026-10-01" });
  const data: RicData = {
    positions: [{ id: "1", name: "Уголь", unit: "т", qty: "100", analogs: ["9000", "9500", "10000", "9800", "9700"].map((p, i) => analog(`a${i}`, p)) }],
    settings: { ...DEFAULT_SETTINGS, nmckVat: "without" },
  };
  const withRic = chartFacts({ econ, estimate, ric: computeRic(data, 1_000_000, NOW) });
  const ric = withRic.find((f) => f.id === "ric");
  assert.ok(ric);
  assert.match(ric.value, /^[+−]\d+,\d\s%$/);
  assert.equal(chartFacts({ econ, estimate, ric: computeRic(EMPTY_RIC, 1_000_000, NOW) }).some((f) => f.id === "ric"), false);
});

test("нет затрат: рентабельности и снижения нет, риски к цене остаются — они от договора, а не от затрат", () => {
  const facts = chartFacts({ econ: econOf({ costs: null }), estimate: estimateOf(), ric: null });
  assert.deepEqual(facts.map((f) => f.id), ["risks"]);
});

test("ось: круглые отметки, ноль внутри, они покрывают все значения", () => {
  const ticks = niceTicks(-73_007, 356_993);
  assert.deepEqual(ticks, [-100_000, 0, 100_000, 200_000, 300_000, 400_000]);
  assert.deepEqual(niceTicks(10, 90), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(-50, -10), [-50, -40, -30, -20, -10, 0]);
  assert.deepEqual(niceTicks(0, 0), [0]);
  const t = niceTicks(-1_234_567, 987_654, 5);
  assert.ok(t[0] <= -1_234_567 && t[t.length - 1] >= 987_654 && t.includes(0));
});

test("подписи оси: тысячи и миллионы сжаты, минус настоящий", () => {
  assert.equal(compactRub(0), "0");
  assert.equal(compactRub(300_000), "300 тыс.");
  assert.equal(compactRub(1_200_000), "1,2 млн");
  assert.equal(compactRub(-73_000), "−73 тыс.");
  assert.equal(compactRub(950), "950");
  assert.equal(compactRub(2_000_000), "2 млн");
});

test("проценты для карточек: проверено проверок из 27 — когда есть матрица; охват и число по уровням", () => {
  const econ = econOf();
  const estimate = estimateOf();
  const matrix = { total: 27, program: 9, manual: 1, insufficient: 5, notChecked: 12, coveragePct: (10 / 27) * 100, ok: 6, attention: 3, risk: 1, uniqueAttention: 2, uniqueRisk: 1, groups: [], first: [] };
  const facts = chartFacts({ econ, estimate, ric: null, matrix });
  const f = facts.find((x) => x.id === "checks")!;
  assert.equal(f.value, "10 из 27");
  assert.match(f.hint.replace(/\s/g, " "), /^37,0 %: в порядке 6, внимание 3, риск 1; остальные ждут данных$/);
  assert.equal(chartFacts({ econ, estimate, ric: null }).some((x) => x.id === "checks"), false);
});
