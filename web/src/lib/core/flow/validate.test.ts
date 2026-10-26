import assert from "node:assert/strict";
import { test } from "node:test";
import { questionFlow, testFlow, testRule } from "./test-fixtures.ts";
import type { FlowModule } from "./types.ts";
import { assertValidFlow, validateFlow } from "./validate.ts";

const hasCode = (flow: FlowModule, code: string, nodeId?: string) =>
  validateFlow(flow).some((issue) => issue.code === code && (nodeId === undefined || issue.nodeId === nodeId));

test("валидный граф не имеет замечаний", () => {
  assert.deepEqual(validateFlow(testFlow()), []);
});

test("дубликат узла", () => {
  const flow = testFlow();
  flow.nodes.push({ id: "extract", type: "extract", fields: ["flag"], source: "required", label: "Дубль" });

  assert.equal(hasCode(flow, "node.duplicate", "extract"), true);
});

test("ребро в неизвестный узел", () => {
  const flow = testFlow();
  flow.edges.push({ from: "extract", to: "missing", on: "always" });

  assert.equal(hasCode(flow, "edge.to"), true);
});

test("недостижимый узел", () => {
  const flow = testFlow();
  flow.nodes.push({ id: "orphan", type: "decision", outcome: "unknown", label: "Осиротевший" });

  assert.equal(hasCode(flow, "node.unreachable", "orphan"), true);
});

test("цикл в графе", () => {
  const flow = testFlow();
  flow.edges = flow.edges.filter((edge) => !(edge.from === "extract" && edge.on === "always"));
  flow.edges.push({ from: "extract", to: "extract", on: "always" });

  assert.equal(hasCode(flow, "flow.cycle"), true);
});

test("проверка ссылается на неизвестное правило", () => {
  const flow = testFlow();
  const check = flow.nodes.find((node) => node.id === "check");
  if (check?.type === "check") check.ruleId = "missing.rule";

  assert.equal(hasCode(flow, "node.check.rule", "check"), true);
});

test("у правового правила пустой source", () => {
  const flow = testFlow();
  flow.rules = [{ ...testRule, source: "" }];

  assert.equal(hasCode(flow, "rule.source"), true);
});

test("у правила некорректная дата", () => {
  const flow = testFlow();
  flow.rules = [{ ...testRule, effectiveFrom: "2026-13-01" }];

  assert.equal(hasCode(flow, "rule.effective_from"), true);
});

test("дубликат правила", () => {
  const flow = testFlow();
  flow.rules.push({ ...testRule });

  assert.equal(hasCode(flow, "rule.duplicate"), true);
});

test("у терминального узла есть исходящее ребро", () => {
  const flow = testFlow();
  flow.edges.push({ from: "yes", to: "no", on: "always" });

  assert.equal(hasCode(flow, "node.terminal.outgoing", "yes"), true);
});

test("у не-терминального узла нет исходящих рёбер", () => {
  const flow = testFlow();
  flow.edges = flow.edges.filter((edge) => edge.from !== "extract");

  assert.equal(hasCode(flow, "node.outgoing", "extract"), true);
});

test("у проверки нет ветки провала", () => {
  const flow = testFlow();
  flow.edges = flow.edges.filter((edge) => !(edge.from === "check" && edge.on === "no"));

  assert.equal(hasCode(flow, "node.check.fail", "check"), true);
});

test("у boolean-вопроса нет ветки «нет»", () => {
  const flow = questionFlow();
  flow.edges = flow.edges.filter((edge) => edge.on !== "no");

  assert.equal(hasCode(flow, "node.question.boolean", "question"), true);
});

test("у value-ребра нет значения", () => {
  const flow: FlowModule = {
    key: "choice",
    name: "Выбор",
    version: "0.1.0",
    start: "question",
    nodes: [
      { id: "question", type: "question", question: "Выбор", answer: "choice", field: "choice", label: "Вопрос" },
      { id: "done", type: "decision", outcome: "participate", label: "Готово" },
    ],
    edges: [{ from: "question", to: "done", on: "value" }],
    rules: [],
  };

  assert.equal(hasCode(flow, "edge.value"), true);
});

test("assertValidFlow бросает ошибку с описанием", () => {
  const flow = testFlow();
  flow.start = "missing";

  assert.throws(() => assertValidFlow(flow), /Invalid flow/);
});
