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

const yearRule: Rule = {
  id: "automobiles.year",
  law: "44-ФЗ",
  article: "ст. 33, 43",
  condition: "Год выпуска автомобиля не ранее требуемого",
  requiredDocument: "Подтверждение года выпуска",
  validationLogic: "minYear отсутствует или vehicleYear >= minYear",
  riskLevel: "high",
  effectiveFrom: "2014-01-01",
  source: LAW_44_ART_43,
  status: "seed",
  evaluate: (context) => {
    const minYear = numberField(context, "minYear");
    if (minYear === null) return pass("Требование к году выпуска не установлено");
    const vehicleYear = numberField(context, "vehicleYear");
    if (vehicleYear === null) return needs("vehicleYear", "Не указан год выпуска автомобиля");
    if (vehicleYear < minYear) return fail(`Год выпуска ${vehicleYear} раньше требуемого ${minYear}`);
    return pass(`Год выпуска ${vehicleYear} не раньше требуемого ${minYear}`);
  },
};

const mileageRule: Rule = {
  id: "automobiles.mileage",
  law: "44-ФЗ",
  article: "ст. 33, 43",
  condition: "Пробег автомобиля не больше допустимого",
  requiredDocument: "Подтверждение пробега",
  validationLogic: "maxMileage отсутствует или vehicleMileage <= maxMileage",
  riskLevel: "high",
  effectiveFrom: "2014-01-01",
  source: LAW_44_ART_43,
  status: "seed",
  evaluate: (context) => {
    const maxMileage = numberField(context, "maxMileage");
    if (maxMileage === null) return pass("Требование к пробегу не установлено");
    const vehicleMileage = numberField(context, "vehicleMileage");
    if (vehicleMileage === null) return needs("vehicleMileage", "Не указан пробег автомобиля");
    if (vehicleMileage > maxMileage) return fail(`Пробег ${vehicleMileage} км больше допустимого ${maxMileage} км`);
    return pass(`Пробег ${vehicleMileage} км не больше допустимого ${maxMileage} км`);
  },
};

export const automobileRules: Rule[] = [
  requiredDocumentRule({
    id: "automobiles.vin",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "VIN и идентификация автомобиля подтверждены",
    requiredDocument: "VIN и идентификационные документы",
    validationLogic: "vinRequired === true → vinConfirmed подтверждён",
    riskLevel: "blocker",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    requiredField: "vinRequired",
    evidenceField: "vinConfirmed",
    notRequiredDetail: "Подтверждение VIN не требуется",
    missingRequiredDetail: "Не определено, требуется ли подтверждение VIN",
    missingEvidenceDetail: "Нет подтверждения VIN",
    notConfirmedDetail: "VIN не подтверждён",
    confirmedDetail: "VIN подтверждён",
  }),
  yearRule,
  mileageRule,
  requiredDocumentRule({
    id: "automobiles.legal_status",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Правовой статус автомобиля чист",
    requiredDocument: "Подтверждение отсутствия залога и ограничений",
    validationLogic: "legalStatusRequired === true → legalStatusConfirmed подтверждён",
    riskLevel: "blocker",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    requiredField: "legalStatusRequired",
    evidenceField: "legalStatusConfirmed",
    notRequiredDetail: "Проверка правового статуса не требуется",
    missingRequiredDetail: "Не определено, требуется ли проверка правового статуса",
    missingEvidenceDetail: "Нет подтверждения правового статуса автомобиля",
    notConfirmedDetail: "Правовой статус автомобиля не подтверждён",
    confirmedDetail: "Правовой статус автомобиля подтверждён",
  }),
];
