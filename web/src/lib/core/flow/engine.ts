import { assertValidFlow } from "./validate.ts";
import type {
  EdgeCondition,
  Finding,
  FlowContext,
  FlowEdge,
  FlowInput,
  FlowModule,
  FlowNode,
  FlowResult,
  MissingInput,
  Outcome,
  Rule,
  RuleEvaluation,
  TraceStep,
} from "./types.ts";

const isMissingValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

const addMissing = (context: FlowContext, input: MissingInput): void => {
  if (context.missing.some((item) => item.field === input.field)) return;
  context.missing.push(input);
};

const findEdge = (edges: FlowEdge[], from: string, on: EdgeCondition, value?: string): FlowEdge | undefined =>
  edges.find((edge) => edge.from === from && edge.on === on && (on !== "value" || edge.value === value));

const normalizeAnswer = (value: unknown): unknown => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["yes", "true", "да", "1"].includes(normalized)) return true;
    if (["no", "false", "нет", "0"].includes(normalized)) return false;
    return value.trim();
  }
  return value;
};

const toFinding = (nodeId: string, rule: Rule, evaluation: RuleEvaluation): Finding => ({
  nodeId,
  ruleId: rule.id,
  status: evaluation.missing.length > 0 ? "unknown" : evaluation.passed ? "passed" : "failed",
  riskLevel: rule.riskLevel,
  message: evaluation.detail,
  law: rule.law,
  article: rule.article,
  requiredDocument: rule.requiredDocument,
  effectiveFrom: rule.effectiveFrom,
  source: rule.source,
  ruleStatus: rule.status,
});

type StepResult = {
  next?: string;
  outcome?: Outcome;
};

function executeNode(
  node: FlowNode,
  context: FlowContext,
  rules: Map<string, Rule>,
  edges: FlowEdge[],
  trace: TraceStep[]
): StepResult {
  if (node.type === "extract") {
    const missingFields: string[] = [];
    for (const field of node.fields) {
      const value = context.input.data[field];
      if (isMissingValue(value)) {
        missingFields.push(field);
        if (node.source === "required") {
          addMissing(context, { nodeId: node.id, field, label: field, kind: "extract" });
        }
      } else {
        context.outputs[field] = value;
      }
    }
    const requiredMissing = node.source === "required" && missingFields.length > 0;
    trace.push({
      nodeId: node.id,
      type: node.type,
      status: requiredMissing ? "missing" : "ok",
      detail: missingFields.length > 0 ? `Нет полей: ${missingFields.join(", ")}` : `Извлечено полей: ${node.fields.length}`,
    });
    return { next: findEdge(edges, node.id, "always")?.to };
  }

  if (node.type === "question") {
    const raw = context.answers[node.id] ?? context.input.data[node.field];
    if (isMissingValue(raw)) {
      addMissing(context, { nodeId: node.id, field: node.field, label: node.question, kind: node.answer });
      trace.push({ nodeId: node.id, type: node.type, status: "needs_input", detail: node.question });
      return { outcome: "needs_input" };
    }
    context.outputs[node.field] = raw;
    const answer = normalizeAnswer(raw);
    const edge =
      node.answer === "boolean"
        ? findEdge(edges, node.id, answer === true ? "yes" : "no")
        : findEdge(edges, node.id, "value", String(answer)) ?? findEdge(edges, node.id, "always");
    trace.push({
      nodeId: node.id,
      type: node.type,
      status: edge ? "ok" : "stopped",
      detail: `${node.question}: ${String(answer)}`,
    });
    return edge ? { next: edge.to } : { outcome: "unknown" };
  }

  if (node.type === "check") {
    const rule = rules.get(node.ruleId);
    if (!rule) throw new Error(`Unknown rule ${node.ruleId}`);
    const evaluation = rule.evaluate(context);
    context.findings.push(toFinding(node.id, rule, evaluation));
    if (evaluation.missing.length > 0) {
      for (const field of evaluation.missing) {
        addMissing(context, { nodeId: node.id, field, label: field, kind: "extract" });
      }
      trace.push({ nodeId: node.id, type: node.type, status: "missing", detail: evaluation.detail });
      const always = findEdge(edges, node.id, "always");
      return always ? { next: always.to } : { outcome: "needs_input" };
    }
    const edge = findEdge(edges, node.id, evaluation.passed ? "yes" : "no") ?? findEdge(edges, node.id, "always");
    trace.push({
      nodeId: node.id,
      type: node.type,
      status: evaluation.passed ? "ok" : "failed",
      detail: evaluation.detail,
    });
    if (edge) return { next: edge.to };
    return { outcome: rule.riskLevel === "blocker" ? "do_not_participate" : "report" };
  }

  if (node.type === "calc") {
    const result = node.compute(context);
    Object.assign(context.outputs, result.outputs);
    if (result.missing) {
      for (const field of result.missing) {
        addMissing(context, { nodeId: node.id, field, label: field, kind: "extract" });
      }
    }
    trace.push({
      nodeId: node.id,
      type: node.type,
      status: result.missing?.length ? "missing" : "ok",
      detail: result.detail ?? `Расчёт: ${node.label}`,
    });
    if (result.missing?.length) {
      const always = findEdge(edges, node.id, "always");
      return always ? { next: always.to } : { outcome: "needs_input" };
    }
    return { next: findEdge(edges, node.id, "always")?.to };
  }

  if (node.type === "score") {
    const result = node.compute(context);
    Object.assign(context.outputs, result.outputs);
    trace.push({
      nodeId: node.id,
      type: node.type,
      status: "ok",
      detail: result.detail ?? `Скоринг: ${node.label}`,
    });
    return { next: findEdge(edges, node.id, "always")?.to };
  }

  if (node.type === "decision") {
    trace.push({ nodeId: node.id, type: node.type, status: "ok", detail: node.label });
    return { outcome: node.outcome };
  }

  if (node.type === "generate") {
    context.outputs["generatedTemplate"] = node.template;
    trace.push({ nodeId: node.id, type: node.type, status: "ok", detail: node.label });
    return { outcome: "prepare_application" };
  }

  context.outputs["reportReason"] = node.reason;
  trace.push({ nodeId: node.id, type: node.type, status: "ok", detail: node.reason });
  return { outcome: "report" };
}

export function runFlow(module: FlowModule, input: FlowInput): FlowResult {
  assertValidFlow(module);

  const nodes = new Map(module.nodes.map((node) => [node.id, node]));
  const rules = new Map(module.rules.map((rule) => [rule.id, rule]));
  const context: FlowContext = {
    input,
    answers: input.answers ?? {},
    outputs: {},
    findings: [],
    missing: [],
  };
  const trace: TraceStep[] = [];
  const visited: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = module.start;
  let outcome: Outcome = "unknown";

  while (current) {
    if (seen.has(current)) throw new Error(`Unexpected cycle at ${current}`);
    seen.add(current);
    visited.push(current);
    const node = nodes.get(current);
    if (!node) throw new Error(`Unknown node ${current}`);
    const result = executeNode(node, context, rules, module.edges, trace);
    if (result.outcome) {
      outcome = result.outcome;
      break;
    }
    if (!result.next) {
      outcome = "unknown";
      break;
    }
    current = result.next;
  }

  return {
    moduleKey: module.key,
    moduleVersion: module.version,
    outcome,
    trace,
    findings: context.findings,
    missing: context.missing,
    outputs: context.outputs,
    visited,
  };
}
