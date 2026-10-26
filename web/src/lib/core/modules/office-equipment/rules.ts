import { matchCharacteristics } from "../../common/characteristics.ts";
import {
  antidumpingRule,
  applicationSecurityRule,
  contractSecurityRule,
  deadlineRule,
  deliveryScheduleRule,
  law44Rule,
  lowRiskRule,
  marginRule,
  noBlockersRule,
} from "../../common/goods.ts";
import { participantRules } from "../../common/participant.ts";
import type { EvidenceValue, FlowContext, Rule, RuleEvaluation } from "../../flow/types.ts";

const LAW_44_ART_43 = "https://www.consultant.ru/document/cons_doc_LAW_144624/5a18b3d46fe0fd48f2482cd6ec7ce419763efccd/";
const INTERNAL = "Внутренняя политика Core v1";

const field = (context: FlowContext, key: string): unknown => {
  if (Object.prototype.hasOwnProperty.call(context.outputs, key)) return context.outputs[key];
  return context.input.data[key];
};

const textField = (context: FlowContext, key: string): string | null => {
  const value = field(context, key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

const productKindRule: Rule = {
  id: "office.product_kind",
  law: "internal",
  article: "scope",
  condition: "Объект закупки — оргтехника",
  requiredDocument: null,
  validationLogic: "productKind === 'office_equipment'",
  riskLevel: "high",
  effectiveFrom: "2026-10-26",
  source: INTERNAL,
  status: "seed",
  evaluate: (context) => {
    const kind = textField(context, "productKind");
    if (!kind) return needs("productKind", "Не определён тип объекта закупки");
    if (kind === "office_equipment") return pass("Объект закупки: оргтехника");
    return fail(`Объект закупки не относится к оргтехнике: ${kind}`);
  },
};

const characteristicsRule: Rule = {
  id: "office.characteristics",
  law: "44-ФЗ",
  article: "ст. 33, 43",
  condition: "Характеристики оргтехники соответствуют ТЗ",
  requiredDocument: "Таблица характеристик по ТЗ",
  validationLogic: "построчное сопоставление; иначе officeCharacteristicsMatch",
  riskLevel: "blocker",
  effectiveFrom: "2014-01-01",
  source: LAW_44_ART_43,
  status: "seed",
  evaluate: (context) => {
    const required = field(context, "requiredCharacteristics");
    const offered = field(context, "productCharacteristics");
    if (Array.isArray(required) || Array.isArray(offered)) {
      const result = matchCharacteristics(required, offered);
      if (result.missing.length > 0) return needs(result.missing[0], "Нужны требования ТЗ и характеристики товара");
      if (!result.matched) {
        const names = result.mismatches.map((item) => item.name).join(", ");
        return fail(`Расхождения по характеристикам: ${names}`);
      }
      return pass("Характеристики сопоставлены построчно");
    }
    const match = evidencedBoolean(context, "officeCharacteristicsMatch");
    if (match === null) return needs("officeCharacteristicsMatch", "Нет подтверждённого сопоставления характеристик");
    if (!match) return fail("Характеристики не соответствуют ТЗ");
    return pass("Характеристики соответствуют ТЗ");
  },
};

const warrantyRule: Rule = {
  id: "office.warranty",
  law: "44-ФЗ",
  article: "ст. 33, 43",
  condition: "Гарантийные обязательства предусмотрены закупкой",
  requiredDocument: "Гарантийные документы",
  validationLogic: "warrantyRequired === true → warrantyIncluded подтверждён",
  riskLevel: "high",
  effectiveFrom: "2014-01-01",
  source: LAW_44_ART_43,
  status: "seed",
  evaluate: (context) => {
    const required = booleanField(context, "warrantyRequired");
    if (required === null) return needs("warrantyRequired", "Не определено, требуется ли гарантия");
    if (!required) return pass("Гарантия не требуется");
    const included = evidencedBoolean(context, "warrantyIncluded");
    if (included === null) return needs("warrantyIncluded", "Нет подтверждения гарантийных обязательств");
    if (!included) return fail("Гарантийные обязательства не подтверждены");
    return pass("Гарантийные обязательства подтверждены");
  },
};

export const officeRules: Rule[] = [
  ...participantRules,
  law44Rule("office.law_44fz"),
  productKindRule,
  deadlineRule("office.deadline"),
  characteristicsRule,
  warrantyRule,
  deliveryScheduleRule("office.delivery_schedule"),
  applicationSecurityRule("office.security.application"),
  contractSecurityRule("office.security.contract"),
  marginRule("office.margin"),
  antidumpingRule("office.antidumping"),
  noBlockersRule("office.blockers"),
  lowRiskRule("office.low_risk"),
];
