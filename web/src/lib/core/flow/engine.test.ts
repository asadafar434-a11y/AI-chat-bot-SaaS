import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "./engine.ts";
import { questionFlow, testFlow } from "./test-fixtures.ts";
import type { FlowModule } from "./types.ts";

test("граф исполняется до решения и сохраняет трассировку", () => {
  const result = runFlow(testFlow(), { data: { flag: true } });

  assert.equal(result.outcome, "participate");
  assert.deepEqual(result.visited, ["extract", "check", "yes"]);
  assert.equal(result.trace.length, 3);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.status, "passed");
  assert.equal(result.findings[0]?.ruleStatus, "seed");
  assert.equal(result.missing.length, 0);
});

test("провал проверки уводит в ветку «нет»", () => {
  const result = runFlow(testFlow(), { data: { flag: false } });

  assert.equal(result.outcome, "do_not_participate");
  assert.deepEqual(result.visited, ["extract", "check", "no"]);
  assert.equal(result.findings[0]?.status, "failed");
});

test("недостающее поле останавливает поток и возвращает needs_input", () => {
  const result = runFlow(testFlow(), { data: {} });

  assert.equal(result.outcome, "needs_input");
  assert.equal(result.missing[0]?.field, "flag");
  assert.equal(result.findings[0]?.status, "unknown");
});

test("вопрос выбирает ветку по ответу", () => {
  const result = runFlow(questionFlow(), { data: {}, answers: { question: true } });

  assert.equal(result.outcome, "participate");
  assert.equal(result.outputs.hasDocument, true);
});

test("без ответа на вопрос поток просит ввод", () => {
  const result = runFlow(questionFlow(), { data: {} });

  assert.equal(result.outcome, "needs_input");
  assert.equal(result.missing[0]?.field, "hasDocument");
});

test("calc и score записывают результаты в outputs", () => {
  const flow: FlowModule = {
    key: "calc",
    name: "Расчёт",
    version: "0.1.0",
    start: "extract",
    nodes: [
      { id: "extract", type: "extract", fields: ["cost", "price"], source: "required", label: "Извлечение" },
      {
        id: "calc",
        type: "calc",
        label: "Расчёт",
        compute: (context) => {
          const cost = Number(context.outputs.cost);
          const price = Number(context.outputs.price);
          return { outputs: { margin: price - cost }, detail: "Маржа" };
        },
      },
      {
        id: "score",
        type: "score",
        label: "Скоринг",
        compute: (context) => ({
          outputs: { riskScore: Number(context.outputs.margin) < 0 ? 40 : 0 },
          detail: "Риск",
        }),
      },
      { id: "done", type: "decision", outcome: "participate", label: "Готово" },
    ],
    edges: [
      { from: "extract", to: "calc", on: "always" },
      { from: "calc", to: "score", on: "always" },
      { from: "score", to: "done", on: "always" },
    ],
    rules: [],
  };

  const result = runFlow(flow, { data: { cost: 100, price: 150 } });

  assert.equal(result.outputs.margin, 50);
  assert.equal(result.outputs.riskScore, 0);
  assert.deepEqual(result.visited, ["extract", "calc", "score", "done"]);
});

test("невалидный граф не исполняется", () => {
  const flow = testFlow();
  flow.start = "missing";

  assert.throws(() => runFlow(flow, { data: { flag: true } }), /Invalid flow/);
});
