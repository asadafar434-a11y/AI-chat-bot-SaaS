import type { EvidenceValue, FlowContext, Rule, RuleEvaluation } from "../flow/types.ts";

const LAW_44 = "https://www.consultant.ru/document/cons_doc_LAW_144624/";
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

const numberField = (context: FlowContext, key: string): number | null => {
  const value = field(context, key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

export const law44Rule = (id: string): Rule => ({
  id,
  law: "internal",
  article: "scope",
  condition: "Модуль поддерживает только 44-ФЗ",
  requiredDocument: null,
  validationLogic: "law содержит 44-ФЗ",
  riskLevel: "high",
  effectiveFrom: "2026-10-26",
  source: INTERNAL,
  status: "seed",
  evaluate: (context) => {
    const law = textField(context, "law");
    if (!law) return needs("law", "Не определён закон закупки");
    if (law.includes("223")) return fail("223-ФЗ не поддерживается в этом модуле");
    if (law.includes("44")) return pass("Закон закупки: 44-ФЗ");
    return fail(`Неизвестный закон закупки: ${law}`);
  },
});

export const deadlineRule = (id: string): Rule => ({
  id,
  law: "internal",
  article: "deadline-policy",
  condition: "Срок подачи заявки не истёк",
  requiredDocument: null,
  validationLogic: "submissionDeadline >= now",
  riskLevel: "blocker",
  effectiveFrom: "2026-10-26",
  source: INTERNAL,
  status: "seed",
  evaluate: (context) => {
    const deadline = textField(context, "submissionDeadline");
    if (!deadline) return needs("submissionDeadline", "Не указан срок подачи заявки");
    const now = textField(context, "now");
    if (!now) return needs("now", "Не указана текущая дата для проверки срока");
    const deadlineTime = Date.parse(deadline);
    const nowTime = Date.parse(now);
    if (Number.isNaN(deadlineTime) || Number.isNaN(nowTime)) {
      return needs("submissionDeadline", "Некорректная дата срока подачи");
    }
    if (deadlineTime < nowTime) return fail(`Срок подачи истёк: ${deadline}`);
    return pass(`Срок подачи: ${deadline}`);
  },
});

export const deliveryScheduleRule = (id: string): Rule => ({
  id,
  law: "44-ФЗ",
  article: "ст. 33",
  condition: "Срок поставки соответствует требованиям закупки",
  requiredDocument: "Подтверждение срока поставки",
  validationLogic: "deliveryRequiredDate → deliveryOfferedDate <= required; иначе maxDeliveryDays → deliveryDays <= max",
  riskLevel: "high",
  effectiveFrom: "2014-01-01",
  source: LAW_44_ART_43,
  status: "seed",
  evaluate: (context) => {
    const requiredDate = textField(context, "deliveryRequiredDate");
    if (requiredDate) {
      const offeredDate = textField(context, "deliveryOfferedDate");
      if (!offeredDate) return needs("deliveryOfferedDate", "Не указан предлагаемый срок поставки");
      const requiredTime = Date.parse(requiredDate);
      const offeredTime = Date.parse(offeredDate);
      if (Number.isNaN(requiredTime) || Number.isNaN(offeredTime)) {
        return needs("deliveryOfferedDate", "Некорректная дата срока поставки");
      }
      if (offeredTime > requiredTime) {
        return fail(`Поставка ${offeredDate} позже требуемой ${requiredDate}`);
      }
      return pass(`Поставка ${offeredDate} не позже требуемой ${requiredDate}`);
    }
    const maxDays = numberField(context, "maxDeliveryDays");
    if (maxDays === null) return pass("Требование к сроку поставки не установлено");
    const days = numberField(context, "deliveryDays");
    if (days === null) return needs("deliveryDays", "Не указан срок поставки в днях");
    if (days > maxDays) return fail(`Срок поставки ${days} дн. больше допустимого ${maxDays} дн.`);
    return pass(`Срок поставки ${days} дн. не больше допустимого ${maxDays} дн.`);
  },
});

export const applicationSecurityRule = (id: string): Rule => ({
  id,
  law: "44-ФЗ",
  article: "ст. 44",
  condition: "Обеспечение заявки предусмотрено закупкой",
  requiredDocument: "Обеспечение заявки",
  validationLogic: "applicationSecurityRequired === true → сумма >= требуемой; форма/срок — если заданы",
  riskLevel: "high",
  effectiveFrom: "2014-01-01",
  source: LAW_44,
  status: "seed",
  evaluate: (context) => {
    const required = booleanField(context, "applicationSecurityRequired");
    if (required === null) return needs("applicationSecurityRequired", "Не определено, требуется ли обеспечение заявки");
    if (!required) return pass("Обеспечение заявки не требуется");
    const provided = evidencedBoolean(context, "applicationSecurityProvided");
    if (provided === null) return needs("applicationSecurityProvided", "Нет подтверждения обеспечения заявки");
    if (!provided) return fail("Обеспечение заявки не подтверждено");
    const requiredAmount = numberField(context, "applicationSecurityRequiredAmount");
    if (requiredAmount === null) return needs("applicationSecurityRequiredAmount", "Не указана требуемая сумма обеспечения заявки");
    const amount = numberField(context, "applicationSecurityAmount");
    if (amount === null) return needs("applicationSecurityAmount", "Не указана сумма обеспечения заявки");
    if (amount < requiredAmount) return fail(`Обеспечение заявки ${amount} меньше требуемого ${requiredAmount}`);
    const requiredForm = textField(context, "applicationSecurityFormRequired");
    if (requiredForm) {
      const form = textField(context, "applicationSecurityForm");
      if (!form) return needs("applicationSecurityForm", "Не указана форма обеспечения заявки");
      if (form.toLowerCase() !== requiredForm.toLowerCase()) {
        return fail(`Форма обеспечения заявки «${form}» не совпадает с требуемой «${requiredForm}»`);
      }
    }
    const requiredUntil = textField(context, "applicationSecurityRequiredUntil");
    if (requiredUntil) {
      const validUntil = textField(context, "applicationSecurityValidUntil");
      if (!validUntil) return needs("applicationSecurityValidUntil", "Не указан срок действия обеспечения заявки");
      const requiredTime = Date.parse(requiredUntil);
      const validTime = Date.parse(validUntil);
      if (Number.isNaN(requiredTime) || Number.isNaN(validTime)) {
        return needs("applicationSecurityValidUntil", "Некорректная дата обеспечения заявки");
      }
      if (validTime < requiredTime) {
        return fail(`Обеспечение заявки действует до ${validUntil}, требуется до ${requiredUntil}`);
      }
    }
    return pass(`Обеспечение заявки ${amount} не меньше требуемого ${requiredAmount}`);
  },
});

export const contractSecurityRule = (id: string): Rule => ({
  ...applicationSecurityRule(id),
  id,
  article: "ст. 96",
  condition: "Обеспечение исполнения контракта предусмотрено закупкой",
  requiredDocument: "Обеспечение исполнения контракта",
  validationLogic: "contractSecurityRequired === true → сумма >= требуемой; форма/срок — если заданы",
  evaluate: (context) => {
    const required = booleanField(context, "contractSecurityRequired");
    if (required === null) return needs("contractSecurityRequired", "Не определено, требуется ли обеспечение контракта");
    if (!required) return pass("Обеспечение контракта не требуется");
    const provided = evidencedBoolean(context, "contractSecurityProvided");
    if (provided === null) return needs("contractSecurityProvided", "Нет подтверждения обеспечения контракта");
    if (!provided) return fail("Обеспечение исполнения контракта не подтверждено");
    const requiredAmount = numberField(context, "contractSecurityRequiredAmount");
    if (requiredAmount === null) return needs("contractSecurityRequiredAmount", "Не указана требуемая сумма обеспечения контракта");
    const amount = numberField(context, "contractSecurityAmount");
    if (amount === null) return needs("contractSecurityAmount", "Не указана сумма обеспечения контракта");
    if (amount < requiredAmount) return fail(`Обеспечение контракта ${amount} меньше требуемого ${requiredAmount}`);
    const requiredForm = textField(context, "contractSecurityFormRequired");
    if (requiredForm) {
      const form = textField(context, "contractSecurityForm");
      if (!form) return needs("contractSecurityForm", "Не указана форма обеспечения контракта");
      if (form.toLowerCase() !== requiredForm.toLowerCase()) {
        return fail(`Форма обеспечения контракта «${form}» не совпадает с требуемой «${requiredForm}»`);
      }
    }
    const requiredUntil = textField(context, "contractSecurityRequiredUntil");
    if (requiredUntil) {
      const validUntil = textField(context, "contractSecurityValidUntil");
      if (!validUntil) return needs("contractSecurityValidUntil", "Не указан срок действия обеспечения контракта");
      const requiredTime = Date.parse(requiredUntil);
      const validTime = Date.parse(validUntil);
      if (Number.isNaN(requiredTime) || Number.isNaN(validTime)) {
        return needs("contractSecurityValidUntil", "Некорректная дата обеспечения контракта");
      }
      if (validTime < requiredTime) {
        return fail(`Обеспечение контракта действует до ${validUntil}, требуется до ${requiredUntil}`);
      }
    }
    return pass(`Обеспечение контракта ${amount} не меньше требуемого ${requiredAmount}`);
  },
});

export const marginRule = (id: string): Rule => ({
  id,
  law: "internal",
  article: "economics",
  condition: "Цена покрывает себестоимость",
  requiredDocument: null,
  validationLogic: "margin >= 0",
  riskLevel: "high",
  effectiveFrom: "2026-10-26",
  source: INTERNAL,
  status: "seed",
  evaluate: (context) => {
    const margin = numberField(context, "margin");
    if (margin === null) return needs("margin", "Не рассчитана маржа");
    if (margin < 0) return fail(`Отрицательная маржа: ${margin}`);
    return pass(`Маржа: ${margin}`);
  },
});

export const antidumpingRule = (id: string): Rule => ({
  id,
  law: "44-ФЗ",
  article: "ст. 37",
  condition: "Снижение цены на 25% и более",
  requiredDocument: "Повышенное обеспечение (x1.5) или обоснование цены",
  validationLogic: "offerPrice <= nmck * 0.75 → обеспечение или обоснование подтверждены",
  riskLevel: "high",
  effectiveFrom: "2014-01-01",
  source: LAW_44,
  status: "seed",
  evaluate: (context) => {
    const nmck = numberField(context, "nmck");
    if (nmck === null) return needs("nmck", "Не указана НМЦК");
    const offerPrice = numberField(context, "offerPrice");
    if (offerPrice === null) return needs("offerPrice", "Не указана цена предложения");
    const threshold = nmck * 0.75;
    if (offerPrice > threshold) return pass(`Цена выше порога антидемпинга ${threshold}`);
    const security = evidencedBoolean(context, "antidumpingSecurityProvided");
    const justification = evidencedBoolean(context, "priceJustificationProvided");
    if (security === null && justification === null) {
      return needs("antidumpingConsequence", "Нужно обеспечение x1.5 или обоснование цены");
    }
    if (security === true || justification === true) {
      return pass(`Антидемпинг покрыт: ${security === true ? "обеспечение" : "обоснование цены"}`);
    }
    return fail("Цена ниже порога, но обеспечение и обоснование не подтверждены");
  },
});

export const noBlockersRule = (id: string): Rule => ({
  id,
  law: "internal",
  article: "blockers",
  condition: "Нет блокирующих нарушений",
  requiredDocument: null,
  validationLogic: "нет findings со status failed и riskLevel blocker",
  riskLevel: "blocker",
  effectiveFrom: "2026-10-26",
  source: INTERNAL,
  status: "seed",
  evaluate: (context) => {
    const blockers = context.findings.filter((finding) => finding.status === "failed" && finding.riskLevel === "blocker");
    if (blockers.length > 0) {
      return fail(`Блокирующие нарушения: ${blockers.map((finding) => finding.ruleId ?? finding.nodeId).join(", ")}`);
    }
    return pass("Блокирующих нарушений нет");
  },
});

export const lowRiskRule = (id: string): Rule => ({
  id,
  law: "internal",
  article: "risk-policy",
  condition: "Итоговый риск ниже порога",
  requiredDocument: null,
  validationLogic: "riskScore < 40",
  riskLevel: "high",
  effectiveFrom: "2026-10-26",
  source: INTERNAL,
  status: "seed",
  evaluate: (context) => {
    const score = numberField(context, "riskScore");
    if (score === null) return needs("riskScore", "Не рассчитан риск");
    if (score >= 40) return fail(`Риск ${score} выше порога 40`);
    return pass(`Риск ${score} ниже порога 40`);
  },
});
