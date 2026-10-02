// Финальный шлюз подачи заявки — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  submissionGate,
  workflowState,
  type GateInput,
  type WorkflowStateInput,
} from "./submission-gate.ts";
import type { AuditReport } from "./submission-audit.ts";
import type { ApplicationField } from "./fields.ts";
import type { Fact } from "./evidence-base.ts";

// ——— вспомогательные конструкторы ——————————————————————————————————————————

function emptyAudit(): AuditReport {
  return { critical: 0, warnings: 0, info: 0, findings: [], risk: "low" };
}

function auditWith(severity: "CRITICAL" | "WARNING", id = "f1"): AuditReport {
  return {
    critical: severity === "CRITICAL" ? 1 : 0,
    warnings: severity === "WARNING" ? 1 : 0,
    info: 0,
    risk: severity === "CRITICAL" ? "high" : "medium",
    findings: [
      {
        id,
        severity,
        what: "Нет обязательного документа",
        requirement: "ст. 43 ч. 3",
        source: "ТЗ",
        evidence: null,
        fix: "Составьте документ",
      },
    ],
  };
}

function field(
  key: string,
  status: ApplicationField["status"],
  required = true,
  problem?: string,
): ApplicationField {
  return {
    key,
    label: `Поле ${key}`,
    doc: "ТП",
    part: null,
    kind: "confirm",
    status,
    value: status === "needs_confirmation" ? "значение от ИИ" : "",
    source: "ТЗ",
    required,
    problem,
  };
}

function aiFact(id: string, confirmed = false): Fact {
  return {
    id,
    kind: "experience",
    title: `Контракт ${id}`,
    fields: {},
    measures: [],
    validity: {},
    source: { type: "document" } as Fact["source"],
    origin: "ai",
    confirmed,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

function humanFact(id: string): Fact {
  return { ...aiFact(id, false), origin: "human", confirmed: true };
}

// ——— submissionGate: blocking ———————————————————————————————————————————————

test("CRITICAL finding → blocking, canSubmit = false", () => {
  const gate = submissionGate({
    audit: auditWith("CRITICAL"),
    fields: [],
    facts: [],
    confirmedIds: new Set(),
  });
  assert.equal(gate.blocking.length, 1);
  assert.equal(gate.blocking[0]!.kind, "critical_finding");
  assert.equal(gate.canSubmit, false);
});

test("обязательное поле needs_input → blocking", () => {
  const gate = submissionGate({
    audit: emptyAudit(),
    fields: [field("inn", "needs_input", true)],
    facts: [],
    confirmedIds: new Set(),
  });
  assert.equal(gate.blocking.length, 1);
  assert.equal(gate.blocking[0]!.kind, "missing_field");
});

test("необязательное поле needs_input → не blocking", () => {
  const gate = submissionGate({
    audit: emptyAudit(),
    fields: [field("extra", "needs_input", false)],
    facts: [],
    confirmedIds: new Set(),
  });
  assert.equal(gate.blocking.length, 0);
});

test("поле invalid → blocking с текстом проблемы", () => {
  const gate = submissionGate({
    audit: emptyAudit(),
    fields: [field("price", "invalid", true, "120 — по ТЗ не менее 150")],
    facts: [],
    confirmedIds: new Set(),
  });
  assert.equal(gate.blocking.length, 1);
  assert.equal(gate.blocking[0]!.kind, "invalid_field");
  assert.ok(gate.blocking[0]!.what.includes("120 — по ТЗ не менее 150"));
});

// ——— submissionGate: confirmable ————————————————————————————————————————————

test("поле needs_confirmation → confirmable", () => {
  const gate = submissionGate({
    audit: emptyAudit(),
    fields: [field("nmck", "needs_confirmation")],
    facts: [],
    confirmedIds: new Set(),
  });
  assert.equal(gate.needsConfirmation.length, 1);
  assert.equal(gate.needsConfirmation[0]!.kind, "ai_filled_field");
  assert.equal(gate.canSubmit, false);
});

test("факт ИИ, не подтверждён → confirmable", () => {
  const gate = submissionGate({
    audit: emptyAudit(),
    fields: [],
    facts: [aiFact("f1")],
    confirmedIds: new Set(),
  });
  assert.equal(gate.needsConfirmation.length, 1);
  assert.equal(gate.needsConfirmation[0]!.kind, "unconfirmed_ai_fact");
});

test("факт ИИ подтверждён человеком → не нужно подтверждение", () => {
  const gate = submissionGate({
    audit: emptyAudit(),
    fields: [],
    facts: [aiFact("f1", true)],
    confirmedIds: new Set(),
  });
  assert.equal(gate.needsConfirmation.length, 0);
});

test("факт внесён человеком → не нужно подтверждение", () => {
  const gate = submissionGate({
    audit: emptyAudit(),
    fields: [],
    facts: [humanFact("f1")],
    confirmedIds: new Set(),
  });
  assert.equal(gate.needsConfirmation.length, 0);
  assert.equal(gate.canSubmit, true);
});

test("WARNING finding → confirmable, не blocking", () => {
  const gate = submissionGate({
    audit: auditWith("WARNING"),
    fields: [],
    facts: [],
    confirmedIds: new Set(),
  });
  assert.equal(gate.blocking.length, 0);
  assert.equal(gate.needsConfirmation.length, 1);
  assert.equal(gate.needsConfirmation[0]!.kind, "warning_finding");
});

// ——— submissionGate: подтверждение ——————————————————————————————————————————

test("человек подтвердил confirmable → переходит в confirmed", () => {
  const gate = submissionGate({
    audit: emptyAudit(),
    fields: [field("nmck", "needs_confirmation")],
    facts: [],
    confirmedIds: new Set(["field:nmck:confirm"]),
  });
  assert.equal(gate.needsConfirmation.length, 0);
  assert.equal(gate.confirmed.length, 1);
});

test("все confirmable подтверждены, нет blocking → canSubmit = true", () => {
  const gate = submissionGate({
    audit: emptyAudit(),
    fields: [field("nmck", "needs_confirmation")],
    facts: [aiFact("f1")],
    confirmedIds: new Set(["field:nmck:confirm", "fact:f1"]),
  });
  assert.equal(gate.canSubmit, true);
  assert.equal(gate.summary, "Готово к подаче");
});

test("пустой input → canSubmit = true", () => {
  const gate = submissionGate({
    audit: emptyAudit(),
    fields: [],
    facts: [],
    confirmedIds: new Set(),
  });
  assert.equal(gate.canSubmit, true);
});

// ——— submissionGate: summary ————————————————————————————————————————————————

test("summary: есть blocking → называет количество", () => {
  const gate = submissionGate({
    audit: auditWith("CRITICAL"),
    fields: [],
    facts: [],
    confirmedIds: new Set(),
  });
  assert.ok(gate.summary.includes("1 блокирующих"));
});

test("summary: только confirmable → называет количество", () => {
  const gate = submissionGate({
    audit: auditWith("WARNING"),
    fields: [],
    facts: [],
    confirmedIds: new Set(),
  });
  assert.ok(gate.summary.includes("Подтвердите 1"));
});

// ——— workflowState ——————————————————————————————————————————————————————————

function input(overrides: Partial<WorkflowStateInput> = {}): WorkflowStateInput {
  const gate = submissionGate({
    audit: emptyAudit(),
    fields: [],
    facts: [],
    confirmedIds: new Set(),
  });
  return {
    hasDocuments: false,
    hasRequirements: false,
    factsCount: 0,
    hasTp: false,
    gate,
    ...overrides,
  };
}

function gateWith(overrides: Partial<GateInput>): ReturnType<typeof submissionGate> {
  return submissionGate({
    audit: emptyAudit(),
    fields: [],
    facts: [],
    confirmedIds: new Set(),
    ...overrides,
  });
}

test("workflowState: нет документов → upload needs_action, currentStep = upload", () => {
  const ws = workflowState(input());
  const upload = ws.steps.find((s) => s.id === "upload")!;
  assert.equal(upload.status, "needs_action");
  assert.equal(ws.currentStep, "upload");
});

test("workflowState: есть документы → upload complete", () => {
  const ws = workflowState(input({ hasDocuments: true }));
  const upload = ws.steps.find((s) => s.id === "upload")!;
  assert.equal(upload.status, "complete");
});

test("workflowState: CRITICAL finding → validation needs_action", () => {
  const ws = workflowState(input({
    hasDocuments: true,
    hasRequirements: true,
    factsCount: 1,
    hasTp: true,
    gate: gateWith({ audit: auditWith("CRITICAL") }),
  }));
  const val = ws.steps.find((s) => s.id === "validation")!;
  assert.equal(val.status, "needs_action");
});

test("workflowState: всё заполнено и подтверждено → canSubmit = true, все шаги complete", () => {
  const ws = workflowState(input({
    hasDocuments: true,
    hasRequirements: true,
    factsCount: 2,
    hasTp: true,
    gate: gateWith({}),
  }));
  assert.equal(ws.canSubmit, true);
  const pkg = ws.steps.find((s) => s.id === "package")!;
  assert.equal(pkg.status, "complete");
});

test("workflowState: 7 шагов в фиксированном порядке", () => {
  const ws = workflowState(input());
  const ids = ws.steps.map((s) => s.id);
  assert.deepEqual(ids, [
    "upload", "analysis", "evidence", "assembly", "validation", "confirmation", "package",
  ]);
});

test("workflowState: неподтверждённый AI-факт → evidence needs_action с count", () => {
  const ws = workflowState(input({
    hasDocuments: true,
    hasRequirements: true,
    factsCount: 1,
    gate: gateWith({ facts: [aiFact("x")] }),
  }));
  const ev = ws.steps.find((s) => s.id === "evidence")!;
  assert.equal(ev.status, "needs_action");
  assert.equal(ev.count, 1);
});
