import assert from "node:assert/strict";
import { test } from "node:test";
import { profitabilityScore } from "./profitability-score.ts";

test("идеальные условия → recommended, score высокий", () => {
  const r = profitabilityScore({
    nmck: 5_000_000,
    requirementsMatch: 1,
    requirementsCount: 4,
    deadlineDays: 14,
    estimatedCostRatio: 0.7, // маржа 30%
    competitorCount: 0,
    customerScore: 0.9,
  });
  assert.equal(r.rating, "recommended");
  assert.ok(r.score >= 70);
  assert.equal(r.estimatedMargin, 30);
  assert.equal(r.complexity, "low");
});

test("плохие условия → risky или skip", () => {
  const r = profitabilityScore({
    nmck: 500_000,
    requirementsMatch: 0.2,
    requirementsCount: 20,
    deadlineDays: 1,
    estimatedCostRatio: 0.98, // маржа 2%
    competitorCount: 10,
  });
  assert.ok(r.rating === "risky" || r.rating === "skip");
  assert.ok(r.score < 50);
});

test("нет дополнительных данных → consider или risky", () => {
  const r = profitabilityScore({
    nmck: 2_000_000,
    requirementsMatch: 0.6,
    requirementsCount: 10,
  });
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.signals.length >= 2);
});

test("маржа: 0% → estimatedMargin = 0", () => {
  const r = profitabilityScore({
    nmck: 1_000_000,
    requirementsMatch: 0.5,
    requirementsCount: 5,
    estimatedCostRatio: 1.0,
  });
  assert.equal(r.estimatedMargin, 0);
});

test("complexity: >15 требований → high", () => {
  const r = profitabilityScore({
    nmck: 1_000_000,
    requirementsMatch: 0.8,
    requirementsCount: 16,
  });
  assert.equal(r.complexity, "high");
});

test("complexity: ≤5 требований → low", () => {
  const r = profitabilityScore({
    nmck: 1_000_000,
    requirementsMatch: 0.8,
    requirementsCount: 3,
  });
  assert.equal(r.complexity, "low");
});

test("score всегда в диапазоне 0–100", () => {
  const cases = [
    { requirementsMatch: 0, requirementsCount: 30, deadlineDays: 0, estimatedCostRatio: 1.5, competitorCount: 50 },
    { requirementsMatch: 1, requirementsCount: 1, deadlineDays: 30, estimatedCostRatio: 0.1, competitorCount: 0, customerScore: 1 },
  ];
  for (const c of cases) {
    const r = profitabilityScore({ nmck: 1_000_000, ...c });
    assert.ok(r.score >= 0 && r.score <= 100, `score ${r.score} вышел за границы`);
  }
});

test("label соответствует rating", () => {
  const r = profitabilityScore({ nmck: 5_000_000, requirementsMatch: 1, requirementsCount: 3 });
  assert.ok(r.label.length > 0);
  if (r.rating === "recommended") assert.ok(r.label.includes("Рекомендуем"));
  if (r.rating === "skip") assert.ok(r.label.includes("Не рекомендуем"));
});
