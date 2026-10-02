// Сборка заявки по 7 этапам — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, type BuildInput, type BuildStepId } from "./application-builder.ts";
import type { ApplicationField, Completeness } from "./fields.ts";
import type { FulfillmentPlan } from "./fulfillment.ts";

// ——— вспомогательные функции ———

function plan(mode: FulfillmentPlan["mode"], mandatory = true, blocks = mandatory, part?: FulfillmentPlan["part"]): FulfillmentPlan {
  return {
    mode,
    mandatory,
    blocks,
    basis: "тест",
    todo: "тест",
    item: { text: "тест", source: "тест", quote: "тест", verified: true },
    rule: null,
    title: "тест",
    status: mode === "platform" || mode === "not_required" ? "none" : "todo",
    ...(part ? { part } : {}),
  };
}

function confirm(key: string, status: "filled" | "needs_confirmation"): ApplicationField {
  return { key, label: key, doc: "тест", part: null, kind: "confirm", status, value: "x", source: "", required: true };
}

function auto(key: string): ApplicationField {
  return { key, label: key, doc: "тест", part: null, kind: "auto", status: "filled", value: "x", source: "", required: true };
}

function manual(key: string, required = true): ApplicationField {
  return { key, label: key, doc: "тест", part: null, kind: "manual", status: "needs_input", value: "", source: "", required };
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

const BLOCKED_FINAL: Completeness = {
  ...OK_FINAL,
  fields: { required: 1, filled: 0, empty: 1, invalid: 0 },
  blocking: ["не заполнено обязательных полей: 1"],
  ready: false,
  text: "Не готово",
};

function emptyInput(over: Partial<BuildInput> = {}): BuildInput {
  return {
    plans: [],
    fields: [],
    final: OK_FINAL,
    hasTp: false,
    generatedParts: [],
    ...over,
  };
}

function stepOf(report: ReturnType<typeof buildReport>, id: BuildStepId) {
  return report.steps.find((s) => s.id === id)!;
}

// ——— шаг 1: требуемые документы ———

test("шаг 1: без пунктов «Что подать» — done, деталь про отсутствие пунктов", () => {
  const r = buildReport(emptyInput());
  const s = stepOf(r, "required_documents");
  assert.equal(s.status, "done");
  assert.match(s.detail, /нет/i);
});

test("шаг 1: с обязательными пунктами — done, считает обязательные", () => {
  const r = buildReport(emptyInput({ plans: [plan("upload"), plan("confirm"), plan("not_required", false, false)] }));
  const s = stepOf(r, "required_documents");
  assert.equal(s.status, "done");
  assert.match(s.detail, /2/);
});

// ——— шаг 2: состав пакета ———

test("шаг 2: нет ТП — pending; есть ТП — done", () => {
  assert.equal(stepOf(buildReport(emptyInput()), "existing_documents").status, "pending");
  const withTp = emptyInput({ hasTp: true, generatedParts: ["tp"] });
  assert.equal(stepOf(buildReport(withTp), "existing_documents").status, "done");
});

// ——— шаг 3: генерация документов ———

test("шаг 3: нет ТП — pending", () => {
  const r = buildReport(emptyInput({ plans: [plan("compose", true, true, "tp")] }));
  assert.equal(stepOf(r, "generated_documents").status, "pending");
});

test("шаг 3: есть ТП и все compose-части сгенерированы — done", () => {
  const r = buildReport(emptyInput({
    hasTp: true,
    generatedParts: ["tp", "participant"],
    plans: [plan("compose", true, true, "tp"), plan("compose", true, true, "participant")],
  }));
  assert.equal(stepOf(r, "generated_documents").status, "done");
});

test("шаг 3: одна compose-часть не сгенерирована — partial", () => {
  const r = buildReport(emptyInput({
    hasTp: true,
    generatedParts: ["tp"],
    plans: [plan("compose", true, true, "tp"), plan("compose", true, true, "participant")],
  }));
  assert.equal(stepOf(r, "generated_documents").status, "partial");
});

test("шаг 3: нет compose-планов — done (нечего генерировать)", () => {
  const r = buildReport(emptyInput({
    hasTp: true,
    generatedParts: ["tp"],
    plans: [plan("upload"), plan("confirm")],
  }));
  assert.equal(stepOf(r, "generated_documents").status, "done");
});

// ——— шаг 4: автозаполнение ———

test("шаг 4: нет ТП — pending", () => {
  const r = buildReport(emptyInput({ fields: [auto("profile:inn")] }));
  assert.equal(stepOf(r, "auto_filled").status, "pending");
});

test("шаг 4: есть ТП и auto-поля — done с числом полей в деталях", () => {
  const r = buildReport(emptyInput({ hasTp: true, generatedParts: ["tp"], fields: [auto("profile:inn"), auto("profile:ogrn")] }));
  const s = stepOf(r, "auto_filled");
  assert.equal(s.status, "done");
  assert.match(s.detail, /2/);
});

// ——— шаг 5: подтверждённые факты ———

test("шаг 5: нет confirm-полей — na", () => {
  const r = buildReport(emptyInput({ hasTp: true, generatedParts: ["tp"] }));
  assert.equal(stepOf(r, "confirmed_facts").status, "na");
});

test("шаг 5: все confirm-поля подтверждены — done", () => {
  const r = buildReport(emptyInput({
    hasTp: true,
    generatedParts: ["tp"],
    fields: [confirm("confirm:price", "filled"), confirm("confirm:signer", "filled")],
  }));
  assert.equal(stepOf(r, "confirmed_facts").status, "done");
});

test("шаг 5: часть confirm-полей не подтверждена — partial; ни одного — pending", () => {
  const partial = buildReport(emptyInput({
    hasTp: true,
    generatedParts: ["tp"],
    fields: [confirm("confirm:price", "filled"), confirm("confirm:signer", "needs_confirmation")],
  }));
  assert.equal(stepOf(partial, "confirmed_facts").status, "partial");

  const pending = buildReport(emptyInput({
    hasTp: true,
    generatedParts: ["tp"],
    fields: [confirm("confirm:price", "needs_confirmation")],
  }));
  assert.equal(stepOf(pending, "confirmed_facts").status, "pending");
});

// ——— шаг 6: неизвестные значения отмечены ———

test("шаг 6: нет ТП — pending; есть ТП — done (жёлтые места системой отмечены)", () => {
  assert.equal(stepOf(buildReport(emptyInput()), "unknown_marked").status, "pending");
  const withTp = emptyInput({ hasTp: true, generatedParts: ["tp"], fields: [manual("tp:item:0:0")] });
  assert.equal(stepOf(buildReport(withTp), "unknown_marked").status, "done");
});

test("шаг 6: есть ТП и нет пустых обязательных полей — деталь про заполненность", () => {
  const r = buildReport(emptyInput({ hasTp: true, generatedParts: ["tp"] }));
  const s = stepOf(r, "unknown_marked");
  assert.equal(s.status, "done");
  assert.match(s.detail, /заполн/i);
});

// ——— шаг 7: пакет собран ———

test("шаг 7: нет ТП — pending; ТП есть и final.ready — done; final не ready — partial", () => {
  assert.equal(stepOf(buildReport(emptyInput()), "package_assembled").status, "pending");
  assert.equal(
    stepOf(buildReport(emptyInput({ hasTp: true, generatedParts: ["tp"], final: OK_FINAL })), "package_assembled").status,
    "done"
  );
  assert.equal(
    stepOf(buildReport(emptyInput({ hasTp: true, generatedParts: ["tp"], final: BLOCKED_FINAL })), "package_assembled").status,
    "partial"
  );
});

// ——— общий статус и blockingCount ———

test("общий статус: всё done/na — done; есть pending в блокирующем — pending", () => {
  const clean = buildReport(emptyInput({ hasTp: true, generatedParts: ["tp"], final: OK_FINAL, plans: [plan("upload")] }));
  assert.equal(clean.overall, "done");

  const bad = buildReport(emptyInput({
    hasTp: true,
    generatedParts: [],
    plans: [plan("compose", true, true, "participant")],
    final: BLOCKED_FINAL,
  }));
  assert.equal(bad.overall, "pending");
  assert.ok(bad.blockingCount > 0);
});

test("ready совпадает с final.ready", () => {
  const a = buildReport(emptyInput({ hasTp: true, generatedParts: ["tp"], final: OK_FINAL }));
  assert.equal(a.ready, true);
  const b = buildReport(emptyInput({ hasTp: true, generatedParts: ["tp"], final: BLOCKED_FINAL }));
  assert.equal(b.ready, false);
});
