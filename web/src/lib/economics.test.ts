// Экономика участия: сценарии, цены «не ниже / безопасная / целевая», таблица снижения; налог и обеспечение — из price-floor.ts, риски — из оценки по договору — npm test (без ИИ).
import assert from "node:assert/strict";
import { test } from "node:test";
import { contractRisks } from "./contract-risks.ts";
import { DEFAULT_ECON, economics, type EconSettings } from "./economics.ts";
import { DEFAULT_ASSUMPTIONS, estimateRisks } from "./risk-estimate.ts";
import type { PriceCalc } from "./price-floor.ts";

const CALC: PriceCalc = {
  nmck: 1_000_000,
  costs: 700_000,
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
const contract = (...lines: string[]) => [{ name: "Проект.docx", text: ["Договор поставки № 1", ...lines].join("\n") }];
const LINES = [
  "7.3. Исполнитель обязан уплатить Заказчику пеню в размере 0,1% от цены Договора за каждый день просрочки.",
  "3.6. Оплата производится Заказчиком в течение 30 дней с даты акта.",
  "10.1. Договор заключается после предоставления Исполнителем обеспечения исполнения Договора в размере 5 % от цены.",
  "2.1. Цена Договора является твёрдой и определяется на весь срок исполнения Договора.",
];
const estimate = (lines: string[], price: number | null = 1_000_000, type: "goods" | "services" = "goods") =>
  estimateRisks({ price, risks: contractRisks(contract(...lines)), type, region: null, assumptions: DEFAULT_ASSUMPTIONS });
const run = (calc: PriceCalc, lines: string[] = LINES, over: Partial<EconSettings> = {}, price: number | null = null) =>
  economics({ calc, estimate: estimate(lines), settings: { ...DEFAULT_ECON, ...over }, price });
// Без договора и без гарантийного резерва (услуги): остаются только затраты, участие и налог.
const pure = (calc: PriceCalc, price: number | null = null) => economics({ calc, estimate: estimate([], 1_000_000, "services"), settings: DEFAULT_ECON, price });
const near = (a: number | null, b: number, eps = 0.02) => assert.ok(a !== null && Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

const FINANCE = (1_000_000 * 14 * 30) / 100 / 365; // 11 506,85
const ready = (r: ReturnType<typeof economics>) => {
  assert.equal(r.ready, true);
  return r as Extract<ReturnType<typeof economics>, { ready: true }>;
};

test("нет затрат или начальной цены — расчёта нет, а не «посчитали по нулям»", () => {
  assert.deepEqual(run({ ...CALC, costs: null }), { ready: false, reason: "costs" });
  assert.deepEqual(run({ ...CALC, costs: 0 }), { ready: false, reason: "costs" });
  assert.deepEqual(run({ ...CALC, nmck: null }), { ready: false, reason: "nmck" });
});

test("без договора: прибыль = цена − затраты − участие − налог; оптимистичный — затраты ниже на 5 %, стрессовый — выше на 10 %", () => {
  const r = ready(pure(CALC));
  assert.equal(r.price, 1_000_000);
  assert.equal(r.scenarios.base.profit, 230_000);
  assert.equal(r.scenarios.base.margin, 23);
  assert.equal(r.scenarios.optimistic.profit, 265_000);
  assert.equal(r.scenarios.stress.profit, 160_000);
  assert.deepEqual(r.scenarios.base.lines.map((l) => l.label), ["Затраты на исполнение", "Расходы на участие", "Налог с выручки"]);
  assert.equal(r.penaltyUsed, null);
});

test("с договором: проценты за деньги, гарантия, гарантийный резерв — в базовом; в стрессе ещё рост затрат, двойной резерв и одна неустойка", () => {
  const r = ready(run(CALC));
  near(r.scenarios.base.profit, 230_000 - 1_500 - FINANCE - 20_000);
  near(r.scenarios.optimistic.profit, 265_000 - 1_500 - FINANCE);
  near(r.scenarios.stress.profit, 160_000 - 1_500 - FINANCE - 40_000 - 10_000);
  assert.match(r.penaltyUsed ?? "", /пеня 0,1 %/);
  assert.ok(r.scenarios.stress.lines.some((l) => l.label === "Неустойка (один случай)" && l.amount === 10_000));
  assert.ok(r.scenarios.base.lines.some((l) => l.label === "Проценты за деньги до оплаты"));
});

test("таблица снижения цены: на 10 % ниже начальной все суммы, пропорциональные цене, пересчитываются", () => {
  const r = ready(run(CALC));
  const row = r.table.find((t) => t.drop === 10)!;
  assert.equal(row.price, 900_000);
  near(row.base, 900_000 - 700_000 - 10_000 - 54_000 - 1_350 - FINANCE * 0.9 - 18_000);
  assert.deepEqual(r.table.map((t) => t.drop), [0, 5, 10, 15, 20, 25, 30]);
  assert.ok(r.table[0].base > r.table[6].base, "чем глубже снижение, тем меньше прибыль");
});

test("три цены: не ниже (базовый сценарий без убытка), безопасная (выдержит стресс), целевая (маржа 10 % в базовом)", () => {
  const r = ready(run(CALC));
  near(r.min, 710_000 / (1 - 0.06 - 0.0015 - FINANCE / 1_000_000 - 0.02));
  near(r.safe, 780_000 / (1 - 0.06 - 0.0015 - FINANCE / 1_000_000 - 0.04 - 0.01));
  near(r.target, 710_000 / (1 - 0.06 - 0.0015 - FINANCE / 1_000_000 - 0.02 - 0.1));
  assert.ok(r.min! < r.target! && r.target! < r.safe!, `${r.min} < ${r.target} < ${r.safe}`);
  const higher = ready(run(CALC, LINES, { targetMarginPct: 15 }));
  assert.ok(higher.target! > r.target!, "выше целевая маржа — выше цена");
});

test("затраты слишком велики: даже по начальной цене убыток — три цены не достижимы", () => {
  const r = ready(run({ ...CALC, costs: 950_000 }));
  assert.equal(r.min, null);
  assert.equal(r.safe, null);
  assert.equal(r.target, null);
  assert.ok(r.scenarios.base.profit < 0);
});

test("договор допускает индексацию цены — стрессовый сценарий без роста затрат; ставка обеспечения введена на шаге «Цена» — гарантия не считается дважды", () => {
  const indexed = ready(run(CALC, [...LINES, "5.6. Поставщик вправе не реже одного раза в 6 месяцев осуществлять индексацию цены Товара в соответствии с индексами потребительских цен."]));
  assert.equal(indexed.growthApplied, false);
  near(indexed.scenarios.stress.profit, 230_000 - 1_500 - FINANCE - 40_000 - 10_000, 0.02);
  const own = ready(run({ ...CALC, guaranteeRatePct: 4, days: 365 }));
  const guarantee = own.scenarios.base.lines.filter((l) => l.label === "Обеспечение исполнения");
  assert.equal(guarantee.length, 1);
  assert.equal(guarantee[0].amount, 2_000, "5 % × 1 000 000 × 4 % — по ставке участника, а не плюс допущение");
});

test("цена заявки: сценарии считаются на ней, а не на начальной", () => {
  const r = ready(pure(CALC, 800_000));
  assert.equal(r.price, 800_000);
  assert.equal(r.scenarios.base.profit, 800_000 - 700_000 - 10_000 - 48_000);
});
