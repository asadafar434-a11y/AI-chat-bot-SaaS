import type { FlowContext, Rule, RuleEvaluation } from "../flow/types.ts";

const LAW_44_ART_43 = "https://www.consultant.ru/document/cons_doc_LAW_144624/5a18b3d46fe0fd48f2482cd6ec7ce419763efccd/";

const field = (context: FlowContext, key: string): unknown => {
  if (Object.prototype.hasOwnProperty.call(context.outputs, key)) return context.outputs[key];
  return context.input.data[key];
};

const textField = (context: FlowContext, key: string): string | null => {
  const value = field(context, key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

export const serviceScheduleRule = (id: string): Rule => ({
  id,
  law: "44-ФЗ",
  article: "ст. 33",
  condition: "Срок оказания услуг соответствует требованиям закупки",
  requiredDocument: "Подтверждение срока оказания услуг",
  validationLogic: "serviceRequiredDate → serviceOfferedDate <= required; иначе maxServiceDays → serviceDays <= max",
  riskLevel: "high",
  effectiveFrom: "2014-01-01",
  source: LAW_44_ART_43,
  status: "seed",
  evaluate: (context) => {
    const requiredDate = textField(context, "serviceRequiredDate");
    if (requiredDate) {
      const offeredDate = textField(context, "serviceOfferedDate");
      if (!offeredDate) return needs("serviceOfferedDate", "Не указан предлагаемый срок оказания услуг");
      const requiredTime = Date.parse(requiredDate);
      const offeredTime = Date.parse(offeredDate);
      if (Number.isNaN(requiredTime) || Number.isNaN(offeredTime)) {
        return needs("serviceOfferedDate", "Некорректная дата срока оказания услуг");
      }
      if (offeredTime > requiredTime) {
        return fail(`Услуги ${offeredDate} позже требуемой даты ${requiredDate}`);
      }
      return pass(`Услуги ${offeredDate} не позже требуемой даты ${requiredDate}`);
    }
    const maxDays = numberField(context, "maxServiceDays");
    if (maxDays === null) return pass("Требование к сроку оказания услуг не установлено");
    const days = numberField(context, "serviceDays");
    if (days === null) return needs("serviceDays", "Не указан срок оказания услуг в днях");
    if (days > maxDays) return fail(`Срок оказания услуг ${days} дн. больше допустимого ${maxDays} дн.`);
    return pass(`Срок оказания услуг ${days} дн. не больше допустимого ${maxDays} дн.`);
  },
});
