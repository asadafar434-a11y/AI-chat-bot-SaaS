import type { EvidenceValue, FlowContext, RiskLevel, Rule, RuleEvaluation } from "../flow/types.ts";

export type DocumentRuleConfig = {
  id: string;
  law: string;
  article: string;
  condition: string;
  requiredDocument: string;
  validationLogic: string;
  riskLevel: RiskLevel;
  effectiveFrom: string;
  source: string;
  requiredField: string;
  evidenceField: string;
  notRequiredDetail: string;
  missingRequiredDetail: string;
  missingEvidenceDetail: string;
  notConfirmedDetail: string;
  confirmedDetail: string;
};

const field = (context: FlowContext, key: string): unknown => {
  if (Object.prototype.hasOwnProperty.call(context.outputs, key)) return context.outputs[key];
  return context.input.data[key];
};

const booleanField = (context: FlowContext, key: string): boolean | null => {
  const value = field(context, key);
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "да", "1"].includes(normalized)) return true;
  if (["false", "no", "нет", "0"].includes(normalized)) return false;
  return null;
};

const evidenceOf = (context: FlowContext, key: string): EvidenceValue | null => {
  const item = context.input.evidence?.[key];
  if (!item || item.source.trim().length === 0) return null;
  return item;
};

const evidencedBoolean = (context: FlowContext, key: string): boolean | null => {
  const item = evidenceOf(context, key);
  if (!item) return null;
  return typeof item.value === "boolean" ? item.value : null;
};

const pass = (detail: string): RuleEvaluation => ({ passed: true, detail, missing: [] });
const fail = (detail: string): RuleEvaluation => ({ passed: false, detail, missing: [] });
const needs = (fieldName: string, detail: string): RuleEvaluation => ({ passed: false, detail, missing: [fieldName] });

export function requiredDocumentRule(config: DocumentRuleConfig): Rule {
  return {
    id: config.id,
    law: config.law,
    article: config.article,
    condition: config.condition,
    requiredDocument: config.requiredDocument,
    validationLogic: config.validationLogic,
    riskLevel: config.riskLevel,
    effectiveFrom: config.effectiveFrom,
    source: config.source,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, config.requiredField);
      if (required === null) return needs(config.requiredField, config.missingRequiredDetail);
      if (!required) return pass(config.notRequiredDetail);
      const document = evidencedBoolean(context, config.evidenceField);
      if (document === null) return needs(config.evidenceField, config.missingEvidenceDetail);
      if (!document) return fail(config.notConfirmedDetail);
      return pass(config.confirmedDetail);
    },
  };
}
