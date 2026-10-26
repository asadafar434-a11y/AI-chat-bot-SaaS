import type { FlowEdge, FlowModule, FlowNode, Rule } from "./types.ts";

export type ValidationIssue = {
  code: string;
  nodeId?: string;
  message: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RISK_LEVELS = new Set(["blocker", "high", "medium", "low"]);
const RULE_STATUSES = new Set(["seed", "legal_reviewed"]);
const TERMINAL_TYPES = new Set(["decision", "generate", "report"]);

const isNonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const isDate = (value: string): boolean => {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const push = (issues: ValidationIssue[], code: string, message: string, nodeId?: string) => {
  issues.push(nodeId ? { code, nodeId, message } : { code, message });
};

function validateRule(rule: Rule, issues: ValidationIssue[]) {
  if (!isNonEmpty(rule.id)) push(issues, "rule.id", "У правила пустой id");
  if (!isNonEmpty(rule.law)) push(issues, "rule.law", `У правила ${rule.id} пустой law`);
  if (!isNonEmpty(rule.article)) push(issues, "rule.article", `У правила ${rule.id} пустой article`);
  if (!isNonEmpty(rule.condition)) push(issues, "rule.condition", `У правила ${rule.id} пустой condition`);
  if (!isNonEmpty(rule.validationLogic)) push(issues, "rule.validation_logic", `У правила ${rule.id} пустой validationLogic`);
  if (!isNonEmpty(rule.source)) push(issues, "rule.source", `У правила ${rule.id} пустой source`);
  if (!isNonEmpty(rule.effectiveFrom) || !isDate(rule.effectiveFrom)) {
    push(issues, "rule.effective_from", `У правила ${rule.id} некорректный effectiveFrom`);
  }
  if (!RISK_LEVELS.has(rule.riskLevel)) {
    push(issues, "rule.risk_level", `У правила ${rule.id} неизвестный riskLevel`);
  }
  if (!RULE_STATUSES.has(rule.status)) {
    push(issues, "rule.status", `У правила ${rule.id} неизвестный status`);
  }
  if (rule.reviewedAt !== undefined) {
    if (!isDate(rule.reviewedAt)) push(issues, "rule.reviewed_at", `У правила ${rule.id} некорректный reviewedAt`);
  } else if (rule.status === "legal_reviewed") {
    push(issues, "rule.reviewed_at", `У юридически проверенного правила ${rule.id} нет reviewedAt`);
  }
  if (rule.edition !== undefined) {
    if (!isNonEmpty(rule.edition)) push(issues, "rule.edition", `У правила ${rule.id} пустая edition`);
  } else if (rule.status === "legal_reviewed") {
    push(issues, "rule.edition", `У юридически проверенного правила ${rule.id} нет edition`);
  }
  if (rule.sourceUrl !== undefined && !isHttpUrl(rule.sourceUrl)) {
    push(issues, "rule.source_url", `У правила ${rule.id} некорректный sourceUrl`);
  }
  if (rule.law !== "internal" && !isNonEmpty(rule.requiredDocument)) {
    push(issues, "rule.required_document", `У правового правила ${rule.id} не указан requiredDocument`);
  }
  if (typeof rule.evaluate !== "function") {
    push(issues, "rule.evaluate", `У правила ${rule.id} нет evaluate`);
  }
}

function validateNode(node: FlowNode, rules: Map<string, Rule>, issues: ValidationIssue[]) {
  if (!isNonEmpty(node.id)) push(issues, "node.id", "У узла пустой id");
  if (!isNonEmpty(node.label)) push(issues, "node.label", `У узла ${node.id} пустой label`);

  if (node.type === "extract") {
    if (!Array.isArray(node.fields) || node.fields.length === 0) {
      push(issues, "node.extract.fields", `У extract ${node.id} нет полей`, node.id);
    }
    if (node.fields.some((field) => !isNonEmpty(field))) {
      push(issues, "node.extract.field", `У extract ${node.id} пустое имя поля`, node.id);
    }
    if (node.source !== "required" && node.source !== "optional") {
      push(issues, "node.extract.source", `У extract ${node.id} неизвестный source`, node.id);
    }
  }

  if (node.type === "question") {
    if (!isNonEmpty(node.question)) push(issues, "node.question.text", `У вопроса ${node.id} пустой текст`, node.id);
    if (!isNonEmpty(node.field)) push(issues, "node.question.field", `У вопроса ${node.id} пустое поле`, node.id);
    if (!["boolean", "text", "number", "choice"].includes(node.answer)) {
      push(issues, "node.question.answer", `У вопроса ${node.id} неизвестный answer`, node.id);
    }
  }

  if (node.type === "check" && !rules.has(node.ruleId)) {
    push(issues, "node.check.rule", `Проверка ${node.id} ссылается на неизвестное правило ${node.ruleId}`, node.id);
  }

  if ((node.type === "calc" || node.type === "score") && typeof node.compute !== "function") {
    push(issues, "node.compute", `У узла ${node.id} нет compute`, node.id);
  }

  if (node.type === "decision" && !["participate", "do_not_participate", "unknown"].includes(node.outcome)) {
    push(issues, "node.decision.outcome", `У решения ${node.id} неизвестный outcome`, node.id);
  }

  if (node.type === "generate" && !isNonEmpty(node.template)) {
    push(issues, "node.generate.template", `У генератора ${node.id} пустой template`, node.id);
  }

  if (node.type === "report" && !isNonEmpty(node.reason)) {
    push(issues, "node.report.reason", `У отчёта ${node.id} пустая причина`, node.id);
  }
}

function outgoingByNode(edges: FlowEdge[], nodes: Map<string, FlowNode>): Map<string, FlowEdge[]> {
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  return outgoing;
}

function findCycle(start: string, outgoing: Map<string, FlowEdge[]>, nodes: Map<string, FlowNode>): string[] | null {
  const visited = new Set<string>();
  const stack: string[] = [];
  const active = new Set<string>();

  const visit = (id: string): string[] | null => {
    if (active.has(id)) {
      const index = stack.indexOf(id);
      return [...stack.slice(index), id];
    }
    if (visited.has(id)) return null;
    active.add(id);
    stack.push(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (!nodes.has(edge.to)) continue;
      const cycle = visit(edge.to);
      if (cycle) return cycle;
    }
    stack.pop();
    active.delete(id);
    visited.add(id);
    return null;
  };

  return visit(start);
}

export function validateFlow(module: FlowModule): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isNonEmpty(module.key)) push(issues, "module.key", "У модуля пустой key");
  if (!isNonEmpty(module.name)) push(issues, "module.name", "У модуля пустой name");
  if (!isNonEmpty(module.version)) push(issues, "module.version", "У модуля пустая version");
  if (!Array.isArray(module.nodes) || module.nodes.length === 0) {
    push(issues, "module.nodes", "У модуля нет узлов");
    return issues;
  }

  const nodes = new Map<string, FlowNode>();
  for (const node of module.nodes) {
    if (nodes.has(node.id)) push(issues, "node.duplicate", `Дубликат узла ${node.id}`, node.id);
    else nodes.set(node.id, node);
  }

  const rules = new Map<string, Rule>();
  for (const rule of module.rules) {
    if (rules.has(rule.id)) push(issues, "rule.duplicate", `Дубликат правила ${rule.id}`);
    else rules.set(rule.id, rule);
    validateRule(rule, issues);
  }

  for (const node of module.nodes) validateNode(node, rules, issues);

  if (!nodes.has(module.start)) {
    push(issues, "module.start", `Стартовый узел ${module.start} не найден`);
  }

  const outgoing = outgoingByNode(module.edges, nodes);
  const seenEdges = new Set<string>();
  for (const edge of module.edges) {
    if (!nodes.has(edge.from)) push(issues, "edge.from", `Ребро из неизвестного узла ${edge.from}`);
    if (!nodes.has(edge.to)) push(issues, "edge.to", `Ребро в неизвестный узел ${edge.to}`);
    if (!["always", "yes", "no", "value"].includes(edge.on)) {
      push(issues, "edge.on", `Неизвестное условие ребра ${String(edge.on)}`);
    }
    if (edge.on === "value" && !isNonEmpty(edge.value)) {
      push(issues, "edge.value", `У ребра ${edge.from} → ${edge.to} нет value`);
    }
    const key = `${edge.from}|${edge.to}|${edge.on}|${edge.value ?? ""}`;
    if (seenEdges.has(key)) push(issues, "edge.duplicate", `Дубликат ребра ${edge.from} → ${edge.to} (${edge.on})`);
    seenEdges.add(key);
  }

  for (const node of module.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    const isTerminal = TERMINAL_TYPES.has(node.type);
    if (isTerminal && edges.length > 0) {
      push(issues, "node.terminal.outgoing", `Терминальный узел ${node.id} имеет исходящие рёбра`, node.id);
    }
    if (!isTerminal && edges.length === 0) {
      push(issues, "node.outgoing", `У узла ${node.id} нет исходящих рёбер`, node.id);
    }

    const count = (condition: string) => edges.filter((edge) => edge.on === condition).length;

    if (node.type === "extract" || node.type === "calc" || node.type === "score") {
      if (count("always") !== 1) push(issues, "node.always", `У узла ${node.id} должно быть ровно одно ребро always`, node.id);
      if (count("yes") + count("no") + count("value") > 0) {
        push(issues, "node.branch", `У узла ${node.id} не должно быть веток yes/no/value`, node.id);
      }
    }

    if (node.type === "check") {
      if (count("yes") + count("always") === 0) push(issues, "node.check.pass", `У проверки ${node.id} нет пути при успехе`, node.id);
      if (count("no") === 0) push(issues, "node.check.fail", `У проверки ${node.id} нет пути при провале`, node.id);
      if (count("yes") > 1 || count("no") > 1 || count("always") > 1) {
        push(issues, "node.check.duplicate_branch", `У проверки ${node.id} дублируются ветки`, node.id);
      }
    }

    if (node.type === "question") {
      if (node.answer === "boolean") {
        if (count("yes") !== 1 || count("no") !== 1) {
          push(issues, "node.question.boolean", `У вопроса ${node.id} нужны ровно yes и no`, node.id);
        }
        if (count("always") + count("value") > 0) {
          push(issues, "node.question.branch", `У boolean-вопроса ${node.id} не должно быть always/value`, node.id);
        }
      } else if (node.answer === "choice") {
        if (count("value") === 0) push(issues, "node.question.choice", `У вопроса ${node.id} нет value-веток`, node.id);
        if (count("yes") + count("no") + count("always") > 0) {
          push(issues, "node.question.branch", `У choice-вопроса ${node.id} не должно быть yes/no/always`, node.id);
        }
      } else if (count("value") + count("always") === 0) {
        push(issues, "node.question.fallback", `У вопроса ${node.id} нет пути`, node.id);
      }
    }
  }

  if (nodes.has(module.start)) {
    const reachable = new Set<string>();
    const queue = [module.start];
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id || reachable.has(id)) continue;
      reachable.add(id);
      for (const edge of outgoing.get(id) ?? []) queue.push(edge.to);
    }
    for (const node of module.nodes) {
      if (!reachable.has(node.id)) push(issues, "node.unreachable", `Узел ${node.id} недостижим из старта`, node.id);
    }

    const cycle = findCycle(module.start, outgoing, nodes);
    if (cycle) push(issues, "flow.cycle", `Цикл: ${cycle.join(" → ")}`);
  }

  if (!module.nodes.some((node) => TERMINAL_TYPES.has(node.type))) {
    push(issues, "flow.terminal", "В графе нет терминального узла");
  }

  return issues;
}

export function assertValidFlow(module: FlowModule): void {
  const issues = validateFlow(module);
  if (issues.length === 0) return;
  const text = issues
    .map((issue) => `${issue.code}${issue.nodeId ? ` [${issue.nodeId}]` : ""}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid flow ${module.key}:\n${text}`);
}
