import { requiredDocumentRule } from "../../common/document-rule.ts";
import type { FlowContext, Rule, RuleEvaluation } from "../../flow/types.ts";

const LAW_44_ART_43 = "https://www.consultant.ru/document/cons_doc_LAW_144624/5a18b3d46fe0fd48f2482cd6ec7ce419763efccd/";

const field = (context: FlowContext, key: string): unknown => {
  if (Object.prototype.hasOwnProperty.call(context.outputs, key)) return context.outputs[key];
  return context.input.data[key];
};

const numberField = (context: FlowContext, key: string): number | null => {
  const value = field(context, key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const pass = (detail: string): RuleEvaluation => ({ passed: true, detail, missing: [] });
const fail = (detail: string): RuleEvaluation => ({ passed: false, detail, missing: [] });
const needs = (fieldName: string, detail: string): RuleEvaluation => ({ passed: false, detail, missing: [fieldName] });

const shelfLifeRule: Rule = {
  id: "food.shelf_life",
  law: "44-ФЗ",
  article: "ст. 33, 43",
  condition: "Остаточный срок годности не меньше требуемого",
  requiredDocument: "Подтверждение остаточного срока годности",
  validationLogic: "shelfLifeRequiredDays отсутствует или offeredShelfLifeDays >= required",
  riskLevel: "high",
  effectiveFrom: "2014-01-01",
  source: LAW_44_ART_43,
  status: "seed",
  evaluate: (context) => {
    const required = numberField(context, "shelfLifeRequiredDays");
    if (required === null) return pass("Требование к сроку годности не установлено");
    const offered = numberField(context, "offeredShelfLifeDays");
    if (offered === null) return needs("offeredShelfLifeDays", "Не указан остаточный срок годности");
    if (offered < required) return fail(`Остаточный срок годности ${offered} дн. меньше требуемого ${required} дн.`);
    return pass(`Остаточный срок годности ${offered} дн. не меньше требуемого ${required} дн.`);
  },
};

export const foodRules: Rule[] = [
  requiredDocumentRule({
    id: "food.conformity",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Продукты питания имеют подтверждение соответствия",
    requiredDocument: "Сертификат или декларация соответствия",
    validationLogic: "conformityRequired === true → conformityDocument подтверждён",
    riskLevel: "blocker",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    requiredField: "conformityRequired",
    evidenceField: "conformityDocument",
    notRequiredDetail: "Подтверждение соответствия не требуется",
    missingRequiredDetail: "Не определено, требуется ли подтверждение соответствия",
    missingEvidenceDetail: "Нет подтверждения сертификата или декларации",
    notConfirmedDetail: "Сертификат или декларация соответствия не подтверждены",
    confirmedDetail: "Подтверждение соответствия есть",
  }),
  shelfLifeRule,
  requiredDocumentRule({
    id: "food.storage",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Условия хранения и транспортировки подтверждены",
    requiredDocument: "Подтверждение условий хранения и транспортировки",
    validationLogic: "storageRequired === true → storageConfirmed подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    requiredField: "storageRequired",
    evidenceField: "storageConfirmed",
    notRequiredDetail: "Подтверждение условий хранения не требуется",
    missingRequiredDetail: "Не определено, требуется ли подтверждение условий хранения",
    missingEvidenceDetail: "Нет подтверждения условий хранения и транспортировки",
    notConfirmedDetail: "Условия хранения и транспортировки не подтверждены",
    confirmedDetail: "Условия хранения и транспортировки подтверждены",
  }),
  requiredDocumentRule({
    id: "food.veterinary",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Ветеринарное сопровождение подтверждено",
    requiredDocument: "Ветеринарный сертификат или заключение",
    validationLogic: "veterinaryRequired === true → veterinaryConfirmed подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    requiredField: "veterinaryRequired",
    evidenceField: "veterinaryConfirmed",
    notRequiredDetail: "Ветеринарное сопровождение не требуется",
    missingRequiredDetail: "Не определено, требуется ли ветеринарное сопровождение",
    missingEvidenceDetail: "Нет подтверждения ветеринарного сопровождения",
    notConfirmedDetail: "Ветеринарное сопровождение не подтверждено",
    confirmedDetail: "Ветеринарное сопровождение подтверждено",
  }),
];
