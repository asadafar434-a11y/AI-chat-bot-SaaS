// Рейтинг привлекательности тендера: прозрачный балл по шести факторам, критические препятствия отдельно, недостаток данных отдельно — npm test (без ИИ).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECKS, type CheckResult, type CheckRow, type Level } from "./check-matrix.ts";
import { DEFAULT_ECON, economics } from "./economics.ts";
import type { PriceBadge } from "./price-badge.ts";
import { contractRisks } from "./contract-risks.ts";
import type { PriceCalc } from "./price-floor.ts";
import { DEFAULT_ASSUMPTIONS, estimateRisks } from "./risk-estimate.ts";
import { FACTOR_WEIGHTS, FULL_COVERAGE, MIN_COVERAGE, rateTender, VERDICTS, verdictOf, type RatingInput } from "./tender-rating.ts";

const CALC: PriceCalc = { nmck: 1_000_000, costs: 700_000, extra: 10_000, taxPct: 6, securityPct: 5, smeOnly: false, exempt: false, method: "guarantee", guaranteeRatePct: null, moneyRatePct: null, days: null, antiDumping: false, goodFaith: false, price: null };
const CALM = ["3.6. Оплата производится Заказчиком в течение 10 дней с даты акта."];

function matrix(levels: Record<number, Level> = {}, weights: Record<number, 1 | 2 | 3> = {}): CheckRow[] {
  return CHECKS.map((def) => {
    const level = levels[def.n];
    const result: CheckResult = level
      ? { state: "checked", level, summary: `итог проверки ${def.n}`, facts: [] }
      : def.computed
        ? { state: "insufficient", summary: "нужны данные", missing: ["данные"] }
        : { state: "not_checked", summary: "источника нет", missing: ["источник"] };
    return { def, result, weight: weights[def.n] ?? def.weight };
  });
}
const QUAL_OK: Record<number, Level> = { 6: "ok", 14: "ok", 15: "ok", 16: "ok", 17: "ok", 18: "ok", 19: "ok" };

function input(over: Partial<RatingInput> = {}, calc: Partial<PriceCalc> = {}, lines: string[] = CALM): RatingInput {
  const risks = contractRisks([{ name: "Проект.docx", text: ["Договор поставки № 1", ...lines].join("\n") }]);
  const estimate = estimateRisks({ price: 1_000_000, risks, type: "goods", region: null, assumptions: DEFAULT_ASSUMPTIONS });
  const econ = economics({ calc: { ...CALC, ...calc }, estimate, settings: DEFAULT_ECON, price: null });
  return { econ, estimate, hasContract: true, badge: null, matrix: matrix(), targetMarginPct: 10, ...over };
}
const badge = (status: PriceBadge["status"], pct = 3): PriceBadge => ({
  status,
  title: status === "within" ? "Цена в рыночном диапазоне" : status === "above" ? "Цена существенно выше рынка" : status === "below" ? "Цена существенно ниже рынка" : "Недостаточно данных для оценки цены",
  missing: [],
  detail: status === "insufficient" ? null : ({ nmck: 1_000_000, ric: 970_000, median: 970_000, range: { from: 900_000, to: 1_050_000 }, abs: 30_000, pct, observations: { min: 5, total: 12 }, dates: { from: "2026-01-01", to: "2026-09-01" }, sources: ["ЕИС"], confidence: "medium", threshold: 15 } as PriceBadge["detail"]),
});
const by = (r: ReturnType<typeof rateTender>, id: string) => r.factors.find((f) => f.id === id)!;

test("веса факторов дают 100; пять вердиктов по порогам 80 / 65 / 50 / 35", () => {
  assert.equal(Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(VERDICTS.map((v) => v.label), ["Отличный тендер", "Перспективный", "Есть риски", "Сложный тендер", "Лучше не участвовать"]);
  assert.equal(verdictOf(80).label, "Отличный тендер");
  assert.equal(verdictOf(79).label, "Перспективный");
  assert.equal(verdictOf(65).label, "Перспективный");
  assert.equal(verdictOf(64).label, "Есть риски");
  assert.equal(verdictOf(50).label, "Есть риски");
  assert.equal(verdictOf(49).label, "Сложный тендер");
  assert.equal(verdictOf(35).label, "Сложный тендер");
  assert.equal(verdictOf(34).label, "Лучше не участвовать");
  assert.equal(verdictOf(0).label, "Лучше не участвовать");
  assert.equal(verdictOf(100).tone, "good");
  assert.equal(verdictOf(55).tone, "warn");
  assert.equal(verdictOf(20).tone, "danger");
});

test("данных нет — балла нет: статус «недостаточно», каждый фактор без оценки и с перечнем, чего не хватает", () => {
  const r = rateTender(input({ econ: { ready: false, reason: "costs" }, hasContract: false, estimate: { items: [], total: 0, totalPct: null, unknown: 0, priceUsed: null, indexed: false } as never }));
  assert.equal(r.status, "insufficient");
  assert.equal(r.score, null);
  assert.equal(r.verdict, null);
  assert.equal(r.coverage, 0);
  assert.ok(r.factors.every((f) => f.score === null && f.missing.length > 0));
  assert.equal(r.missing.length, 6);
  assert.match(by(r, "profit").missing[0], /Себестоимость — на шаге «Цена», блок «Мои расходы»/);
  assert.match(by(r, "risks").missing[0], /Проект договора/);
});

test("есть всё, что программа считает сама: балл по профилю, рентабельности и рискам; цена против рынка учтена в рентабельности; конкуренция и надёжность — «нет данных» и не тянут балл вниз", () => {
  const r = rateTender(input({ matrix: matrix(QUAL_OK), badge: badge("within") }, { costs: 500_000 }));
  assert.equal(r.status, "ready");
  assert.equal(r.coverage, 76, "профиль 25 + рентабельность 25 + риски 15 из 85: вес «цены против рынка» учтён в рентабельности и из базы убран");
  assert.equal(by(r, "competition").score, null);
  assert.equal(by(r, "reliability").score, null);
  assert.equal(by(r, "profile").score, 100);
  assert.equal(by(r, "price").score, null);
  assert.equal(by(r, "price").mergedInto, "profit", "маржа одна: свои затраты точнее рыночных");
  assert.ok(!r.missing.some((m) => m.factor === "Цена относительно рынка"), "учтённый в другом фактор — не нехватка данных");
  assert.ok(r.score! >= 80, `балл ${r.score}`);
  assert.equal(r.verdict!.label, "Отличный тендер");
  assert.equal(r.blockers.length, 0);
  assert.equal(r.capped, false);
});

test("меньше 35 % веса с данными — балла нет (только профиль или только рентабельность); от 35 % балл есть", () => {
  const onlyProfile = rateTender(input({ econ: { ready: false, reason: "costs" }, hasContract: false, matrix: matrix(QUAL_OK) }));
  assert.equal(onlyProfile.coverage, 25);
  assert.equal(onlyProfile.status, "insufficient");
  const half = rateTender(input({ hasContract: false, matrix: matrix(QUAL_OK) }, { costs: 500_000 }));
  assert.equal(half.coverage, 59, "профиль 25 + рентабельность 25 из 85 (цена против рынка учтена в рентабельности)");
  assert.ok(half.coverage >= MIN_COVERAGE);
  assert.equal(half.status, "ready");
  const thin = rateTender(input({ hasContract: false }, { costs: 500_000 }));
  assert.equal(thin.coverage, 29, "только рентабельность: 25 из 85");
  assert.equal(thin.status, "insufficient");
});

test("профиль и риски по договору (40 % веса) — балл уже есть, но предварительный; 70 % и больше — обычный балл без пометки", () => {
  assert.equal(MIN_COVERAGE, 35);
  assert.equal(FULL_COVERAGE, 70);
  const early = rateTender(input({ econ: { ready: false, reason: "costs" }, matrix: matrix(QUAL_OK) }));
  assert.equal(early.coverage, 40, "профиль 25 + риски 15 из 100: затрат нет, вес «цены против рынка» остаётся в базе");
  assert.equal(early.status, "ready");
  assert.equal(early.preliminary, true);
  assert.notEqual(early.score, null);
  const full = rateTender(input({ matrix: matrix(QUAL_OK), badge: badge("within") }, { costs: 500_000 }));
  assert.equal(full.coverage, 76);
  assert.equal(full.preliminary, false);
  const none = rateTender(input({ econ: { ready: false, reason: "costs" }, hasContract: false }));
  assert.equal(none.status, "insufficient");
  assert.equal(none.preliminary, false, "балла нет — пометка не нужна");
});

test("у каждого фактора назван источник данных: откуда берётся и что подключено, а что нет", () => {
  const r = rateTender(input({ matrix: matrix(QUAL_OK) }, { costs: 500_000 }));
  for (const f of r.factors) assert.ok(f.source.length > 15, f.id);
  assert.match(by(r, "profit").source, /себестоимость \(шаг «Цена», блок «Мои расходы»\)/);
  assert.match(by(r, "price").source, /закупочные цены поставщиков/);
  assert.match(by(r, "risks").source, /проект договора/);
  assert.match(by(r, "competition").source, /источник не подключён/);
  assert.match(by(r, "reliability").source, /источники не подключены/);
});

test("рентабельность: цель по марже достигнута — 100, вдвое меньше — 50; убыток при росте затрат (без рисков по договору) — не выше 60; затрат нет — нет данных", () => {
  const high = by(rateTender(input({}, { costs: 500_000 })), "profit");
  assert.equal(high.score, 100);
  const half = by(rateTender(input({ targetMarginPct: 50 }, { costs: 500_000 })), "profit");
  assert.ok(half.score! < 100 && half.score! > 0);
  const none = by(rateTender(input({ econ: { ready: false, reason: "costs" } })), "profit");
  assert.equal(none.score, null);
});

test("рентабельность считается ДО рисков по договору: те же затраты при крупной неустойке не меняют балл рентабельности — риски в своём факторе", () => {
  const heavy = [...CALM, "7.4. Исполнитель уплачивает Заказчику штраф в размере 30% от цены Договора."];
  const a = rateTender(input({}, { costs: 600_000 }, CALM));
  const b = rateTender(input({}, { costs: 600_000 }, heavy));
  assert.equal(by(a, "profit").score, by(b, "profit").score, "рентабельность одинакова");
  assert.ok(by(b, "risks").score! < by(a, "risks").score!, "риск растёт — балл рисков падает");
});

test("риски исполнения: каждый 1 % цены в рисках — минус 2 балла; договора или цены нет — нет данных", () => {
  const fake = (pct: number) => ({ items: [], total: pct * 10_000, totalPct: pct, unknown: 0, priceUsed: 1_000_000, indexed: false }) as never;
  assert.equal(by(rateTender(input({ estimate: fake(0) })), "risks").score, 100);
  assert.equal(by(rateTender(input({ estimate: fake(10) })), "risks").score, 80);
  assert.equal(by(rateTender(input({ estimate: fake(50) })), "risks").score, 0);
  assert.equal(by(rateTender(input({ estimate: fake(80) })), "risks").score, 0, "ниже нуля не уходит");
  assert.equal(by(rateTender(input({ hasContract: false })), "risks").score, null);
});

const withRic = (b: PriceBadge, ric: number): PriceBadge => ({ ...b, detail: { ...b.detail!, ric } });
const noCosts = { econ: { ready: false, reason: "costs" } as const };

test("цена против рынка = запас начальной цены над закупочной рыночной ценой: цель по марже достигнута — 100, пропорционально ниже, ниже закупки — 0; нет данных — нет данных", () => {
  const score = (b: PriceBadge | null) => by(rateTender(input({ ...noCosts, badge: b })), "price").score;
  assert.equal(score(withRic(badge("above"), 850_000)), 100, "запас 15 % при цели 10 %");
  assert.equal(score(withRic(badge("within"), 950_000)), 50, "запас 5 % — половина цели");
  assert.equal(score(badge("within")), 30, "запас 3 % — 30 баллов");
  assert.equal(score(withRic(badge("below"), 1_100_000)), 0, "начальная цена ниже закупочной — убыток");
  assert.equal(score(badge("insufficient")), null);
  assert.equal(score(null), null);
  const note = by(rateTender(input({ ...noCosts, badge: badge("within") })), "price").note;
  assert.match(note, /запас над закупочной ценой 3 % при цели 10 %; цен 12/);
  assert.match(by(rateTender(input({ ...noCosts, badge: null })), "price").missing[0], /Закупочные цены: прайсы, предложения поставщиков, биржа/);
});

test("маржа считается один раз: введены свои затраты — «цена против рынка» учтена в рентабельности (без балла и без нехватки данных); затрат нет — маржу даёт рынок", () => {
  const withCosts = rateTender(input({ badge: withRic(badge("above"), 850_000) }, { costs: 500_000 }));
  const price = by(withCosts, "price");
  assert.equal(price.score, null);
  assert.equal(price.mergedInto, "profit");
  assert.match(price.note, /учтено в рентабельности/);
  assert.equal(by(withCosts, "profit").score, 100);
  const withoutCosts = rateTender(input({ ...noCosts, badge: withRic(badge("above"), 850_000), matrix: matrix(QUAL_OK) }));
  assert.equal(by(withoutCosts, "price").score, 100);
  assert.equal(by(withoutCosts, "price").mergedInto, undefined);
  assert.equal(by(withoutCosts, "profit").score, null);
});

test("квалификация: уровни ok / внимание / риск = 100 / 50 / 0 с весами проверок; непроверенное в балл не входит", () => {
  const mixed = rateTender(input({ matrix: matrix({ 6: "ok", 14: "ok", 15: "attention", 16: "ok", 17: "ok", 18: "ok", 19: "ok" }) }, { costs: 500_000 }));
  const p = by(mixed, "profile");
  assert.ok(p.score! < 100 && p.score! > 80, `профиль ${p.score}`);
  assert.match(p.note, /хуже всего: соответствие требованиям к лицензиям/);
  const few = rateTender(input({ matrix: matrix({ 6: "ok" }) }));
  assert.equal(by(few, "profile").score, null, "проверена одна из семи — этого мало");
});

test("конкуренция и надёжность: баллы появляются, только когда записаны результаты внешних проверок (не меньше половины веса)", () => {
  const r = rateTender(input({ matrix: matrix({ ...QUAL_OK, 1: "ok", 2: "attention", 3: "ok", 4: "ok", 5: "ok" }) }, { costs: 500_000 }));
  assert.ok(by(r, "competition").score !== null);
  assert.equal(by(r, "reliability").score, null);
  assert.equal(r.coverage, 88, "профиль 25 + рентабельность 25 + риски 15 + конкуренция 10 из 85");
});

test("критическое препятствие — убыток даже по начальной цене: балл не выше 34, «Лучше не участвовать», препятствие названо отдельно", () => {
  const r = rateTender(input({ matrix: matrix(QUAL_OK), badge: badge("within") }, { costs: 1_200_000 }));
  assert.equal(r.status, "ready");
  assert.ok(r.rawScore! > 34, `до ограничения ${r.rawScore}`);
  assert.equal(r.score, 34);
  assert.equal(r.capped, true);
  assert.equal(r.verdict!.label, "Лучше не участвовать");
  assert.deepEqual(r.blockers.map((b) => b.id), ["loss"]);
  assert.match(r.blockers[0].text, /Убыток даже по начальной цене/);
});

test("критическое препятствие — нет обязательного подтверждения (риск по проверке важности 3): балл не выше 49, препятствие с названием проверки", () => {
  const r = rateTender(input({ matrix: matrix({ ...QUAL_OK, 15: "risk" }), badge: badge("within") }, { costs: 500_000 }));
  assert.equal(r.blockers.length, 1);
  assert.equal(r.blockers[0].id, "check-15");
  assert.match(r.blockers[0].text, /^Соответствие требованиям к лицензиям: итог проверки 15/);
  assert.ok(r.score! <= 49);
  assert.equal(r.capped, true);
  // Риск по менее важной проверке препятствием не считается.
  const light = rateTender(input({ matrix: matrix({ ...QUAL_OK, 17: "risk" }) }, { costs: 500_000 }));
  assert.equal(light.blockers.length, 0);
});

test("без препятствий ограничения нет: балл равен баллу по факторам", () => {
  const r = rateTender(input({ matrix: matrix(QUAL_OK) }, { costs: 500_000 }));
  assert.equal(r.score, r.rawScore);
  assert.equal(r.capped, false);
});

test("факторы идут в заданном порядке; у каждого — вес, формула словами и (если нет балла) чего не хватает", () => {
  const r = rateTender(input({ matrix: matrix(QUAL_OK) }, { costs: 500_000 }));
  assert.deepEqual(r.factors.map((f) => f.id), ["profile", "profit", "price", "risks", "competition", "reliability"]);
  for (const f of r.factors) {
    assert.ok(f.basis.length > 20, f.id);
    assert.equal(f.weight, FACTOR_WEIGHTS[f.id]);
    if (f.score === null && !f.mergedInto) assert.ok(f.missing.length > 0, f.id);
  }
});

test("цена против рынка без данных: причина «нет файла технических требований» идёт первой в списке, чего не хватает", () => {
  const note = "нет файла «Приложение № 1 — Технические требования»: заказчик приложил его отдельно";
  const r = rateTender({ ...input({ econ: { ready: false, reason: "costs" } }), priceNote: note });
  assert.equal(by(r, "price").missing[0], note);
  assert.ok(by(r, "price").missing.length >= 2, "дальше — обычная причина от ценового бейджа");
  const plain = rateTender(input({ econ: { ready: false, reason: "costs" } }));
  assert.ok(!by(plain, "price").missing.includes(note));
});
