import type { EvidenceValue, FlowContext, Rule, RuleEvaluation } from "../../flow/types.ts";

const LAW_44_ART_43 = "https://www.consultant.ru/document/cons_doc_LAW_144624/5a18b3d46fe0fd48f2482cd6ec7ce419763efccd/";

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

export const workwearRules: Rule[] = [
  {
    id: "workwear.conformity",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Спецодежда и СИЗ имеют подтверждение соответствия",
    requiredDocument: "Сертификат или декларация соответствия ТР ТС 019/2011",
    validationLogic: "conformityRequired === true → conformityDocument подтверждён",
    riskLevel: "blocker",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "conformityRequired");
      if (required === null) return needs("conformityRequired", "Не определено, требуется ли подтверждение соответствия");
      if (!required) return pass("Подтверждение соответствия не требуется");
      const document = evidencedBoolean(context, "conformityDocument");
      if (document === null) return needs("conformityDocument", "Нет подтверждения сертификата или декларации");
      if (!document) return fail("Сертификат или декларация соответствия не подтверждены");
      return pass("Подтверждение соответствия есть");
    },
  },
  {
    id: "workwear.sizing",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Размерный ряд спецодежды покрывает требования закупки",
    requiredDocument: "Таблица размеров и ростовок",
    validationLogic: "sizeRangeRequired === true → sizeRangeCovered подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "sizeRangeRequired");
      if (required === null) return needs("sizeRangeRequired", "Не определено, требуется ли размерный ряд");
      if (!required) return pass("Размерный ряд не требуется");
      const covered = evidencedBoolean(context, "sizeRangeCovered");
      if (covered === null) return needs("sizeRangeCovered", "Нет подтверждения размерного ряда");
      if (!covered) return fail("Размерный ряд не покрывает потребность");
      return pass("Размерный ряд подтверждён");
    },
  },
  {
    id: "workwear.labeling",
    law: "44-ФЗ",
    article: "ст. 33",
    condition: "Маркировка и упаковка соответствуют требованиям закупки",
    requiredDocument: "Подтверждение маркировки и упаковки",
    validationLogic: "labelingRequired === true → labelingConfirmed подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "labelingRequired");
      if (required === null) return needs("labelingRequired", "Не определено, требуется ли маркировка");
      if (!required) return pass("Маркировка не требуется");
      const confirmed = evidencedBoolean(context, "labelingConfirmed");
      if (confirmed === null) return needs("labelingConfirmed", "Нет подтверждения маркировки и упаковки");
      if (!confirmed) return fail("Маркировка и упаковка не подтверждены");
      return pass("Маркировка и упаковка подтверждены");
    },
  },
];
