// Финальная проверка перед подачей — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditReport, type AuditInput, type AuditSeverity } from "./submission-audit.ts";
import type { Completeness } from "./fields.ts";
import type { FulfillmentPlan } from "./fulfillment.ts";
import type { ValidationReport, ValidationFinding } from "./validation-engine.ts";

// ——— вспомогательные функции ———

function finding(
  id: string,
  category: ValidationFinding["category"],
  status: ValidationFinding["status"],
  title = "тест",
  reasons: string[] = ["причина"],
  ref?: string,
): ValidationFinding {
  return { id, category, status, title, reasons, ref };
}

function validReport(findings: ValidationFinding[]): ValidationReport {
  const fail = findings.filter((f) => f.status === "FAIL").length;
  const needsHuman = findings.filter((f) => f.status === "NEEDS_HUMAN_REVIEW").length;
  const worst = fail > 0 ? "FAIL" : needsHuman > 0 ? "NEEDS_HUMAN_REVIEW" : "PASS";
  return { status: worst, findings, pass: findings.length - fail - needsHuman, fail, needsHuman };
}

const OK_FINAL: Completeness = {
  fields: { required: 0, filled: 0, empty: 0, invalid: 0 },
  documents: { required: 0, ready: 0 },
  confirmations: { required: 0, done: 0 },
  signatures: { required: 0, done: 0 },
  blocking: [],
  ready: true,
  text: "Готово",
};

function plan(text = "тест", basis = "ст. 43 44-ФЗ"): FulfillmentPlan {
  return {
    mode: "compose",
    mandatory: true,
    blocks: true,
    basis,
    todo: "составить",
    item: { text, source: "тест", quote: "тест", verified: true },
    rule: null,
    title: text,
    status: "todo",
  };
}

function base(over: Partial<AuditInput> = {}): AuditInput {
  return {
    final: OK_FINAL,
    plans: [],
    fields: [],
    validation: validReport([]),
    today: "2026-10-02",
    ...over,
  };
}

// ——— CRITICAL / WARNING / INFO для разных категорий ———

test("FAIL required_documents → CRITICAL", () => {
  const r = auditReport(base({ validation: validReport([finding("d:1", "required_documents", "FAIL")]) }));
  assert.equal(r.critical, 1);
  assert.equal(r.findings[0]!.severity, "CRITICAL");
});

test("NEEDS required_documents → WARNING", () => {
  const r = auditReport(base({ validation: validReport([finding("d:1", "required_documents", "NEEDS_HUMAN_REVIEW")]) }));
  assert.equal(r.warnings, 1);
  assert.equal(r.findings[0]!.severity, "WARNING");
});

test("FAIL required_fields → CRITICAL", () => {
  const r = auditReport(base({ validation: validReport([finding("f:1", "required_fields", "FAIL")]) }));
  assert.equal(r.critical, 1);
});

test("NEEDS required_fields → WARNING", () => {
  const r = auditReport(base({ validation: validReport([finding("f:1", "required_fields", "NEEDS_HUMAN_REVIEW")]) }));
  assert.equal(r.warnings, 1);
});

test("FAIL dates → CRITICAL, NEEDS dates → INFO", () => {
  const rFail = auditReport(base({ validation: validReport([finding("dt:1", "dates", "FAIL")]) }));
  assert.equal(rFail.critical, 1);
  const rNeeds = auditReport(base({ validation: validReport([finding("dt:1", "dates", "NEEDS_HUMAN_REVIEW")]) }));
  assert.equal(rNeeds.info, 1);
  assert.equal(rNeeds.critical, 0);
  assert.equal(rNeeds.warnings, 0);
});

test("FAIL validity_periods → CRITICAL, NEEDS → WARNING", () => {
  const rFail = auditReport(base({ validation: validReport([finding("v:1", "validity_periods", "FAIL")]) }));
  assert.equal(rFail.critical, 1);
  const rNeeds = auditReport(base({ validation: validReport([finding("v:1", "validity_periods", "NEEDS_HUMAN_REVIEW")]) }));
  assert.equal(rNeeds.warnings, 1);
});

test("FAIL evidence_presence → CRITICAL, NEEDS → WARNING", () => {
  const rFail = auditReport(base({ validation: validReport([finding("e:1", "evidence_presence", "FAIL")]) }));
  assert.equal(rFail.critical, 1);
  const rNeeds = auditReport(base({ validation: validReport([finding("e:1", "evidence_presence", "NEEDS_HUMAN_REVIEW")]) }));
  assert.equal(rNeeds.warnings, 1);
});

test("PASS findings пропускаются", () => {
  const r = auditReport(base({ validation: validReport([finding("p:1", "required_documents", "PASS")]) }));
  assert.equal(r.findings.length, 0);
});

// ——— Поля находки ———

test("finding.what = title validation", () => {
  const r = auditReport(base({ validation: validReport([finding("f:1", "required_fields", "FAIL", "Заполните вместимость")]) }));
  assert.match(r.findings[0]!.what, /Заполните вместимость/);
});

test("finding.fix для required_documents — 'Составьте или прикрепите' когда reason пуст", () => {
  const f = finding("d:1", "required_documents", "FAIL", "тест", []);
  const r = auditReport(base({ validation: validReport([f]) }));
  assert.match(r.findings[0]!.fix, /составьте|прикрепите/i);
});

test("finding.fix для required_documents — plan.todo когда reason задан", () => {
  const f = finding("d:1", "required_documents", "FAIL", "тест", ["Составьте декларацию"]);
  const r = auditReport(base({ validation: validReport([f]) }));
  assert.equal(r.findings[0]!.fix, "Составьте декларацию");
});

test("finding.fix для required_fields FAIL — 'Заполните поле'", () => {
  const r = auditReport(base({ validation: validReport([finding("f:1", "required_fields", "FAIL")]) }));
  assert.match(r.findings[0]!.fix, /заполните/i);
});

test("finding.fix для required_fields NEEDS — 'Подтвердите'", () => {
  const r = auditReport(base({ validation: validReport([finding("f:1", "required_fields", "NEEDS_HUMAN_REVIEW")]) }));
  assert.match(r.findings[0]!.fix, /подтвердите/i);
});

test("finding.evidence = ref из ValidationFinding", () => {
  const r = auditReport(base({ validation: validReport([finding("e:1", "evidence_presence", "FAIL", "факт", [], "fact:abc")]) }));
  assert.equal(r.findings[0]!.evidence, "fact:abc");
});

test("finding.evidence = null когда ref не задан", () => {
  const r = auditReport(base({ validation: validReport([finding("f:1", "required_fields", "FAIL")]) }));
  assert.equal(r.findings[0]!.evidence, null);
});

// ——— Источник обогащается из плана (required_documents) ———

test("required_documents: source из plan.basis если title совпадает", () => {
  const f = finding("d:1", "required_documents", "FAIL", "Декларация об МСП");
  const p = plan("Декларация об МСП", "ч. 5 ст. 43 44-ФЗ");
  const r = auditReport(base({ plans: [p], validation: validReport([f]) }));
  assert.match(r.findings[0]!.source, /44-ФЗ/);
});

// ——— Сортировка: CRITICAL перед WARNING перед INFO ———

test("findings отсортированы CRITICAL → WARNING → INFO", () => {
  const fs = [
    finding("i:1", "dates", "NEEDS_HUMAN_REVIEW"),        // INFO
    finding("w:1", "required_fields", "NEEDS_HUMAN_REVIEW"), // WARNING
    finding("c:1", "required_documents", "FAIL"),            // CRITICAL
  ];
  const r = auditReport(base({ validation: validReport(fs) }));
  const sev = r.findings.map((f) => f.severity) as AuditSeverity[];
  assert.deepEqual(sev, ["CRITICAL", "WARNING", "INFO"]);
});

// ——— Близость дедлайна ———

test("дедлайн через 2 дня → WARNING deadline_proximity", () => {
  const r = auditReport(base({ today: "2026-10-02", deadline: { date: "2026-10-04" } }));
  assert.equal(r.findings.some((f) => f.id === "deadline_proximity" && f.severity === "WARNING"), true);
});

test("дедлайн через 4 дня → нет предупреждения", () => {
  const r = auditReport(base({ today: "2026-10-02", deadline: { date: "2026-10-06" } }));
  assert.equal(r.findings.some((f) => f.id === "deadline_proximity"), false);
});

test("дедлайн сегодня (0 дней) → WARNING", () => {
  const r = auditReport(base({ today: "2026-10-02", deadline: { date: "2026-10-02" } }));
  assert.equal(r.findings.some((f) => f.id === "deadline_proximity" && f.severity === "WARNING"), true);
});

test("если дедлайн уже CRITICAL — нет дублирующего WARNING близости", () => {
  const r = auditReport(base({
    today: "2026-10-02",
    deadline: { date: "2026-10-02" },
    validation: validReport([finding("dates:1", "dates", "FAIL")]),
  }));
  // CRITICAL от dates:1 — deadline_proximity не добавляется
  assert.equal(r.findings.filter((f) => f.id === "deadline_proximity").length, 0);
});

// ——— Риск ———

test("risk: high при critical > 0", () => {
  const r = auditReport(base({ validation: validReport([finding("c:1", "required_documents", "FAIL")]) }));
  assert.equal(r.risk, "high");
});

test("risk: medium при warnings > 0, critical = 0", () => {
  const r = auditReport(base({ validation: validReport([finding("w:1", "required_documents", "NEEDS_HUMAN_REVIEW")]) }));
  assert.equal(r.risk, "medium");
});

test("risk: low при нулях", () => {
  const r = auditReport(base());
  assert.equal(r.risk, "low");
  assert.equal(r.critical, 0);
  assert.equal(r.warnings, 0);
  assert.equal(r.info, 0);
  assert.equal(r.findings.length, 0);
});

// ——— Счётчики ———

test("critical / warnings / info точно считают", () => {
  const fs = [
    finding("c:1", "required_documents", "FAIL"),
    finding("c:2", "required_fields", "FAIL"),
    finding("w:1", "validity_periods", "NEEDS_HUMAN_REVIEW"),
    finding("i:1", "dates", "NEEDS_HUMAN_REVIEW"),
  ];
  const r = auditReport(base({ validation: validReport(fs) }));
  assert.equal(r.critical, 2);
  assert.equal(r.warnings, 1);
  assert.equal(r.info, 1);
});
