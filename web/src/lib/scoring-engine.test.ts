// Движок оценки по критериям — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyFormula,
  extractValue,
  parseFormula,
  proofKinds,
  scoringReport,
  type CompanyValue,
  type ScoringFormula,
} from "./scoring-engine.ts";
import type { Fact } from "./evidence-base.ts";
import type { Criteria, ScoreRow } from "./criteria.ts";

// ——— parseFormula ———

test("parseFormula: бинарное — 'X баллов при наличии'", () => {
  const f = parseFormula("30 баллов при наличии документа / 0 при отсутствии");
  assert.equal(f.kind, "binary");
  assert.equal((f as { kind: "binary"; points: number }).points, 30);
});

test("parseFormula: бинарное — 'при наличии — X'", () => {
  const f = parseFormula("При наличии лицензии — 40 баллов");
  assert.equal(f.kind, "binary");
  assert.equal((f as { kind: "binary"; points: number }).points, 40);
});

test("parseFormula: за единицу без максимума", () => {
  const f = parseFormula("5 баллов за каждый исполненный договор");
  assert.equal(f.kind, "per_unit");
  const p = f as { kind: "per_unit"; pointsEach: number; max: number | null };
  assert.equal(p.pointsEach, 5);
  assert.equal(p.max, null);
});

test("parseFormula: за единицу с максимумом", () => {
  const f = parseFormula("5 баллов за каждый договор, максимум 40 баллов");
  assert.equal(f.kind, "per_unit");
  const p = f as { kind: "per_unit"; pointsEach: number; max: number | null };
  assert.equal(p.pointsEach, 5);
  assert.equal(p.max, 40);
});

test("parseFormula: пороговое — не менее N", () => {
  const f = parseFormula("Не менее 1 исполненного договора — 10 баллов; не менее 3 — 20 баллов; не менее 5 — 30 баллов");
  assert.equal(f.kind, "threshold");
  const t = f as { kind: "threshold"; levels: Array<{ min: number; points: number }> };
  assert.equal(t.levels.length, 3);
  assert.equal(t.levels[0]!.min, 1);
  assert.equal(t.levels[0]!.points, 10);
  assert.equal(t.levels[2]!.min, 5);
  assert.equal(t.levels[2]!.points, 30);
});

test("parseFormula: цена", () => {
  const f = parseFormula("Цена контракта — наименьшая получает 100 баллов");
  assert.equal(f.kind, "price");
});

test("parseFormula: пустая строка → unknown", () => {
  assert.equal(parseFormula("").kind, "unknown");
});

test("parseFormula: нераспознанный текст → unknown", () => {
  const f = parseFormula("По усмотрению комиссии");
  assert.equal(f.kind, "unknown");
});

// ——— proofKinds ———

test("proofKinds: договоры → experience", () => {
  const kinds = proofKinds("Исполненные договоры и акты выполненных работ");
  assert.ok(kinds.includes("experience"));
});

test("proofKinds: лицензия → license", () => {
  const kinds = proofKinds("Лицензия на образовательную деятельность");
  assert.ok(kinds.includes("license"));
});

test("proofKinds: специалисты → employee", () => {
  const kinds = proofKinds("Трудовые договоры и штатное расписание");
  assert.ok(kinds.includes("employee"));
});

test("proofKinds: оборудование → equipment", () => {
  const kinds = proofKinds("Документы на оборудование");
  assert.ok(kinds.includes("equipment"));
});

test("proofKinds: пустая строка → []", () => {
  assert.deepEqual(proofKinds(""), []);
});

// ——— extractValue ———

function fact(kind: Fact["kind"]): Fact {
  return {
    id: "t",
    kind,
    title: "тест",
    fields: {},
    measures: [],
    validity: {},
    source: { type: "manual" },
    origin: "human",
    confirmed: true,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

test("extractValue: нет фактов, experience → count 0", () => {
  const v = extractValue([], ["experience"]);
  assert.equal(v.kind, "count");
  assert.equal((v as { kind: "count"; n: number }).n, 0);
});

test("extractValue: нет фактов, license → present false", () => {
  const v = extractValue([], ["license"]);
  assert.equal(v.kind, "present");
  assert.equal((v as { kind: "present"; yes: boolean }).yes, false);
});

test("extractValue: 3 experience-факта → count 3", () => {
  const v = extractValue([fact("experience"), fact("experience"), fact("experience")], ["experience"]);
  assert.equal(v.kind, "count");
  assert.equal((v as { kind: "count"; n: number }).n, 3);
});

test("extractValue: 1 license-факт → present true", () => {
  const v = extractValue([fact("license")], ["license"]);
  assert.equal(v.kind, "present");
  assert.equal((v as { kind: "present"; yes: boolean }).yes, true);
});

// ——— applyFormula ———

function binary(pts: number): ScoringFormula { return { kind: "binary", points: pts }; }
function perUnit(each: number, max: number | null): ScoringFormula { return { kind: "per_unit", pointsEach: each, max }; }
function threshold(levels: Array<{ min: number; points: number }>): ScoringFormula { return { kind: "threshold", levels }; }
function present(yes: boolean): CompanyValue { return { kind: "present", yes }; }
function count(n: number): CompanyValue { return { kind: "count", n }; }

test("applyFormula: binary true → pts", () => {
  assert.equal(applyFormula(binary(30), 30, present(true)), 30);
});

test("applyFormula: binary false → 0", () => {
  assert.equal(applyFormula(binary(30), 30, present(false)), 0);
});

test("applyFormula: per_unit no cap", () => {
  assert.equal(applyFormula(perUnit(5, null), null, count(4)), 20);
});

test("applyFormula: per_unit with cap", () => {
  assert.equal(applyFormula(perUnit(5, 20), null, count(10)), 20);
});

test("applyFormula: per_unit cap from share", () => {
  assert.equal(applyFormula(perUnit(5, null), 15, count(10)), 15);
});

test("applyFormula: threshold выбирает высший порог", () => {
  const f = threshold([{ min: 1, points: 10 }, { min: 3, points: 20 }, { min: 5, points: 30 }]);
  assert.equal(applyFormula(f, null, count(4)), 20);
  assert.equal(applyFormula(f, null, count(5)), 30);
  assert.equal(applyFormula(f, null, count(0)), 0);
});

test("applyFormula: unknown → null", () => {
  assert.equal(applyFormula({ kind: "unknown" }, 30, present(true)), null);
});

test("applyFormula: price → null", () => {
  assert.equal(applyFormula({ kind: "price" }, 40, present(true)), null);
});

// ——— scoringReport ———

function row(criterion: string, cW: string, indicator: string, iW: string, scoring: string, proof: string): ScoreRow {
  return {
    criterion,
    criterionWeight: cW,
    indicator,
    indicatorWeight: iW,
    detail: "",
    detailWeight: "",
    scoring,
    proof,
    form: "",
    source: "тест",
    quote: "тест",
    verified: true,
  };
}

test("scoringReport: howWins = price → groups пустые, totalPoints null", () => {
  const c: Criteria = { howWins: "price", rows: [] };
  const r = scoringReport({ criteria: c, facts: [] });
  assert.equal(r.groups.length, 0);
  assert.equal(r.totalPoints, null);
  assert.equal(r.howWins, "price");
});

test("scoringReport: howWins = points, бинарный критерий, нет фактов → 0 баллов", () => {
  const c: Criteria = {
    howWins: "points",
    rows: [row("Лицензия", "100 %", "", "", "30 баллов при наличии", "Лицензия СРО")],
  };
  const r = scoringReport({ criteria: c, facts: [] });
  assert.equal(r.groups.length, 1);
  const g = r.groups[0]!;
  assert.equal(g.criteria[0]!.points, 0);
  assert.equal(g.criteria[0]!.value.kind, "present");
  assert.equal((g.criteria[0]!.value as { kind: "present"; yes: boolean }).yes, false);
});

test("scoringReport: бинарный критерий, есть факт → X баллов", () => {
  const c: Criteria = {
    howWins: "points",
    rows: [row("Лицензия", "100 %", "", "", "30 баллов при наличии", "Лицензия СРО")],
  };
  const r = scoringReport({ criteria: c, facts: [fact("license")] });
  assert.equal(r.groups[0]!.criteria[0]!.points, 30);
});

test("scoringReport: unknown-формула → points null, gap заполнен", () => {
  const c: Criteria = {
    howWins: "points",
    rows: [row("Опыт", "100 %", "", "", "По усмотрению комиссии", "Договоры")],
  };
  const r = scoringReport({ criteria: c, facts: [] });
  assert.equal(r.groups[0]!.criteria[0]!.points, null);
  assert.ok(r.groups[0]!.criteria[0]!.gap);
});

test("scoringReport: totalMax = 100 если все веса заданы", () => {
  const c: Criteria = {
    howWins: "points",
    rows: [row("Лицензия", "100 %", "", "", "30 баллов при наличии", "Лицензия")],
  };
  const r = scoringReport({ criteria: c, facts: [fact("license")] });
  assert.equal(r.totalMax, 100);
});

// ——— Относительные формулы (конкурс МСП «Форумная дирекция»: Кi / Кmax и Цmin / Цi) ———

test("parseFormula: относительная — Кi / Кmax, чем больше, тем лучше", () => {
  assert.deepEqual(parseFormula("Баллы = 100 × Кi / Кmax, где Кi — число договоров участника, Кmax — наибольшее число среди участников"), { kind: "relative", best: "max" });
  // формула записана только в цитате, а пересказ модели общий
  assert.deepEqual(parseFormula("Пропорционально числу договоров", "Кi = К / Кmax × 100"), { kind: "relative", best: "max" });
  assert.deepEqual(parseFormula("Балл — отношение числа договоров участника к наибольшему числу среди участников × 100"), { kind: "relative", best: "max" });
});

test("parseFormula: относительная — Цmin / Цi, чем меньше, тем лучше; но «Цена контракта» остаётся ценой для площадки", () => {
  assert.deepEqual(parseFormula("Баллы = Цmin / Цi × 100", ""), { kind: "relative", best: "min" });
  assert.equal(parseFormula("Цена контракта: баллы = Цmin / Цi × 100").kind, "price");
});

test("относительная формула: балла нет, объяснение — словами, а не «формула не распознана»", () => {
  const c: Criteria = {
    howWins: "points",
    rows: [row("Квалификация", "60 %", "Опыт", "100 %", "Баллы = 100 × Кi / Кmax, где Кmax — наибольшее число среди участников", "Договоры")],
  };
  const r = scoringReport({ criteria: c, facts: [fact("experience")] });
  const x = r.groups[0]!.criteria[0]!;
  assert.equal(x.points, null);
  assert.match(x.gap ?? "", /Оценка относительная: ваше значение делят на лучшее среди участников/);
  assert.match(x.gap ?? "", /заранее не посчитать/);
  assert.ok(!/не распознана/.test(x.gap ?? ""));
});

test("прежние формулы не изменились: пороговая и за единицу не принимаются за относительные", () => {
  assert.equal(parseFormula("Не менее 3 договоров — 20 баллов").kind, "threshold");
  assert.equal(parseFormula("5 баллов за каждый договор").kind, "per_unit");
  assert.equal(parseFormula("").kind, "unknown");
});
