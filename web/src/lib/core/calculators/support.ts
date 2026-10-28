import { coreModules, type CoreModuleKey } from "../modules/index.ts";
import type { EvidenceValue, FlowContext, FlowModule, Rule } from "../flow/types.ts";
import type { CalculatorFieldSchema, CalculatorInput, CalculatorValue } from "./types.ts";

/**
 * Calculators accept a flat input bag. Existing rules read plain fields via
 * `context.input.data` but gate some fields through `context.input.evidence`
 * (the "evidencedBoolean"/"evidencedNumber"/"evidencedText" helpers used across
 * common/goods.ts, common/service.ts and the coreModule rule files). Mirroring every
 * primitive value into both places lets a calculator exercise the exact same
 * rule.evaluate()/node.compute() functions the flow engine uses, without the
 * caller having to know which specific field name is evidence-gated.
 */
export function buildCalculatorContext(input: CalculatorInput): FlowContext {
  const data: Record<string, unknown> = {};
  const evidence: Record<string, EvidenceValue> = {};
  for (const [key, value] of Object.entries(input)) {
    data[key] = value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      evidence[key] = { value, source: "calculator-input" };
    }
  }
  return { input: { data, evidence }, answers: {}, outputs: {}, findings: [], missing: [] };
}

export function requireModule(sphereKey: string): FlowModule {
  if (!Object.prototype.hasOwnProperty.call(coreModules, sphereKey)) {
    throw new Error(`Калькулятор: неизвестная сфера ${sphereKey}`);
  }
  return coreModules[sphereKey as CoreModuleKey];
}

export function requireRule(coreModule: FlowModule, ruleId: string): Rule {
  const rule = coreModule.rules.find((candidate) => candidate.id === ruleId);
  if (!rule) throw new Error(`Калькулятор: правило ${ruleId} не найдено в модуле ${coreModule.key}`);
  return rule;
}

export function requireCalcNode(coreModule: FlowModule, nodeId: string): Extract<FlowModule["nodes"][number], { type: "calc" }> {
  const node = coreModule.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.type !== "calc") {
    throw new Error(`Калькулятор: расчётный узел ${nodeId} не найден в модуле ${coreModule.key}`);
  }
  return node;
}

/** Every Rule carries a non-empty `source`; `sourceUrl` is the http(s) link extracted
 * from it for legal rules (see flow/source-url.ts). Falling back to `source` keeps
 * internal-policy rules (no URL) citable without inventing a link. */
export function ruleSourceUrls(coreModule: FlowModule, ruleIds: string[]): string[] {
  const urls = new Set<string>();
  for (const id of ruleIds) {
    const rule = coreModule.rules.find((candidate) => candidate.id === id);
    if (!rule) continue;
    urls.add(rule.sourceUrl ?? rule.source);
  }
  return [...urls];
}

export function readNumber(input: CalculatorInput, key: string): number | null {
  const value = input[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readText(input: CalculatorInput, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function readBoolean(input: CalculatorInput, key: string): boolean | null {
  const value = input[key];
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "да", "1"].includes(normalized)) return true;
  if (["false", "no", "нет", "0"].includes(normalized)) return false;
  return null;
}

/** Money is rounded to whole kopecks (2 decimals). */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Percentages are rounded to one decimal place. */
export function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function field(key: string, label: string, value: number | string | boolean | null, unit?: string): CalculatorValue {
  return unit ? { key, label, value, unit } : { key, label, value };
}

export function missingField(key: string, label: string, kind: CalculatorFieldSchema["kind"] = "number"): CalculatorFieldSchema {
  return { key, label, kind, required: true };
}

/** Угадывает тип недостающего поля по имени — большинство булевых полей в правилах ядра
 * называются по шаблону "...Required"/"...Provided"/"...Confirmed"/"...Matches"/"...Applies"
 * (см. common/goods.ts, common/document-rule.ts, modules/medical/medicine-rules.ts).
 * Нужно только для подписи в UI/CLI; на сам расчёт не влияет. */
export function inferFieldKind(key: string): CalculatorFieldSchema["kind"] {
  if (/^(is|has)[A-Z]/.test(key)) return "boolean";
  if (/(Required|Provided|Confirmed|Matches|Applies|Included|Declaration)$/.test(key)) return "boolean";
  if (/Date$/.test(key)) return "date";
  return "number";
}
