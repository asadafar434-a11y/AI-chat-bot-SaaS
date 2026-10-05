import assert from "node:assert/strict";
import { test } from "node:test";
import { readinessScore } from "./readiness-score.ts";
import type { SubmissionGate } from "./submission-gate.ts";
import type { ScoringReport } from "./scoring-engine.ts";
import type { ValidationReport } from "./validation-engine.ts";

function emptyGate(overrides: Partial<SubmissionGate> = {}): SubmissionGate {
  return {
    canSubmit: true,
    blocking: [],
    needsConfirmation: [],
    confirmed: [],
    summary: "Готово к подаче",
    totalIssues: 0,
    ...overrides,
  };
}

function blockingGate(): SubmissionGate {
  return {
    canSubmit: false,
    blocking: [{ id: "b1", kind: "critical_finding", what: "Нет декларации", source: null, blocking: true }],
    needsConfirmation: [],
    confirmed: [],
    summary: "1 блокирующих",
    totalIssues: 1,
  };
}

test("нет проблем, нет данных о scoring/validation → 100", () => {
  const r = readinessScore({ gate: emptyGate() });
  assert.equal(r.score, 100);
  assert.equal(r.level, "ready");
  assert.equal(r.blocking, 0);
});

test("blocking → уровень critical, баллы gate = 0", () => {
  const r = readinessScore({ gate: blockingGate() });
  assert.equal(r.level, "critical");
  assert.equal(r.breakdown.gate, 0);
  assert.equal(r.blocking, 1);
  assert.ok(r.score < 60);
});

test("2 confirmable без blocking → gate частичный", () => {
  const gate = emptyGate({
    canSubmit: false,
    needsConfirmation: [
      { id: "c1", kind: "ai_filled_field", what: "поле A", source: null, blocking: false },
      { id: "c2", kind: "warning_finding", what: "предупреждение", source: null, blocking: false },
    ],
    totalIssues: 2,
  });
  const r = readinessScore({ gate });
  assert.equal(r.breakdown.gate, 40); // 50 - 2*5
  assert.equal(r.level, "high");
});

test("scoring: 0 из 100 → scoringPoints 0", () => {
  const scoring: ScoringReport = {
    groups: [],
    totalPoints: 0,
    totalMax: 100,
    howWins: "price",
  };
  const r = readinessScore({ gate: emptyGate(), scoring });
  assert.equal(r.breakdown.scoring, 0);
});

test("scoring: 50 из 100 → scoringPoints 15", () => {
  const scoring: ScoringReport = {
    groups: [],
    totalPoints: 50,
    totalMax: 100,
    howWins: "price",
  };
  const r = readinessScore({ gate: emptyGate(), scoring });
  assert.equal(r.breakdown.scoring, 15);
});

test("validation: все PASS → validationPoints 20", () => {
  const validation: ValidationReport = {
    status: "PASS",
    findings: [],
    pass: 9,
    fail: 0,
    needsHuman: 0,
  };
  const r = readinessScore({ gate: emptyGate(), validation });
  assert.equal(r.breakdown.validation, 20);
});

test("validation: всё FAIL → validationPoints 0", () => {
  const validation: ValidationReport = {
    status: "FAIL",
    findings: [],
    pass: 0,
    fail: 9,
    needsHuman: 0,
  };
  const r = readinessScore({ gate: emptyGate(), validation });
  assert.equal(r.breakdown.validation, 0);
});

test("полная картина: идеал → score 100, level ready", () => {
  const scoring: ScoringReport = { groups: [], totalPoints: 100, totalMax: 100, howWins: "price" };
  const validation: ValidationReport = { status: "PASS", findings: [], pass: 9, fail: 0, needsHuman: 0 };
  const r = readinessScore({ gate: emptyGate(), scoring, validation });
  assert.equal(r.score, 100);
  assert.equal(r.level, "ready");
});
