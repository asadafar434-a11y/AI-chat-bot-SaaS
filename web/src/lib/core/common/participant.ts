import type { EvidenceValue, FlowContext, RiskLevel, Rule } from "../flow/types.ts";

const LAW_44 = "https://www.consultant.ru/document/cons_doc_LAW_144624/";
const LAW_44_ART_43 = "https://www.consultant.ru/document/cons_doc_LAW_144624/5a18b3d46fe0fd48f2482cd6ec7ce419763efccd/";

export const participantFields = [
  "participantRegistration",
  "signatoryAuthority",
  "restrictionsClear",
  "bankDetails",
  "majorTransactionRequired",
  "majorTransactionApproved",
  "experienceRequired",
  "experienceConfirmed",
  "smpStatusRequired",
  "smpStatusConfirmed",
] as const;

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

type EvidenceRuleSpec = {
  id: string;
  article: string;
  condition: string;
  requiredDocument: string;
  evidenceField: string;
  passDetail: string;
  failDetail: string;
  missingDetail: string;
  riskLevel: RiskLevel;
  source: string;
};

const evidenceRule = (spec: EvidenceRuleSpec): Rule => ({
  id: spec.id,
  law: "44-ФЗ",
  article: spec.article,
  condition: spec.condition,
  requiredDocument: spec.requiredDocument,
  validationLogic: `${spec.evidenceField} подтверждён`,
  riskLevel: spec.riskLevel,
  effectiveFrom: "2014-01-01",
  source: spec.source,
  status: "seed",
  evaluate: (context) => {
    const value = evidencedBoolean(context, spec.evidenceField);
    if (value === null) return { passed: false, detail: spec.missingDetail, missing: [spec.evidenceField] };
    if (!value) return { passed: false, detail: spec.failDetail, missing: [] };
    return { passed: true, detail: spec.passDetail, missing: [] };
  },
});

type ConditionalEvidenceRuleSpec = EvidenceRuleSpec & {
  requiredField: string;
  notRequiredDetail: string;
  requiredMissingDetail: string;
};

const conditionalEvidenceRule = (spec: ConditionalEvidenceRuleSpec): Rule => ({
  id: spec.id,
  law: "44-ФЗ",
  article: spec.article,
  condition: spec.condition,
  requiredDocument: spec.requiredDocument,
  validationLogic: `${spec.requiredField} === true → ${spec.evidenceField} подтверждён`,
  riskLevel: spec.riskLevel,
  effectiveFrom: "2014-01-01",
  source: spec.source,
  status: "seed",
  evaluate: (context) => {
    const required = booleanField(context, spec.requiredField);
    if (required === null) return { passed: false, detail: spec.requiredMissingDetail, missing: [spec.requiredField] };
    if (!required) return { passed: true, detail: spec.notRequiredDetail, missing: [] };
    const value = evidencedBoolean(context, spec.evidenceField);
    if (value === null) return { passed: false, detail: spec.missingDetail, missing: [spec.evidenceField] };
    if (!value) return { passed: false, detail: spec.failDetail, missing: [] };
    return { passed: true, detail: spec.passDetail, missing: [] };
  },
});

export const participantRules: Rule[] = [
  evidenceRule({
    id: "common.participant.registration",
    article: "ст. 31",
    condition: "Участник зарегистрирован и регистрационные сведения подтверждены",
    requiredDocument: "Выписка ЕГРЮЛ/ЕГРИП или регистрационные сведения",
    evidenceField: "participantRegistration",
    passDetail: "Регистрация участника подтверждена",
    failDetail: "Регистрация участника не подтверждена",
    missingDetail: "Нет подтверждения регистрации участника",
    riskLevel: "blocker",
    source: LAW_44,
  }),
  evidenceRule({
    id: "common.participant.signatory",
    article: "ст. 43",
    condition: "Полномочия подписанта подтверждены",
    requiredDocument: "Документ о полномочиях подписанта",
    evidenceField: "signatoryAuthority",
    passDetail: "Полномочия подписанта подтверждены",
    failDetail: "Полномочия подписанта не подтверждены",
    missingDetail: "Нет подтверждения полномочий подписанта",
    riskLevel: "blocker",
    source: LAW_44_ART_43,
  }),
  evidenceRule({
    id: "common.participant.restrictions",
    article: "ст. 31",
    condition: "Ограничения на участие отсутствуют",
    requiredDocument: "Декларация об отсутствии ограничений",
    evidenceField: "restrictionsClear",
    passDetail: "Ограничения на участие отсутствуют",
    failDetail: "Ограничения на участие не подтверждены",
    missingDetail: "Нет подтверждения отсутствия ограничений",
    riskLevel: "blocker",
    source: LAW_44,
  }),
  evidenceRule({
    id: "common.participant.bank_details",
    article: "ст. 43",
    condition: "Реквизиты счёта участника подтверждены",
    requiredDocument: "Реквизиты расчётного счёта",
    evidenceField: "bankDetails",
    passDetail: "Реквизиты счёта подтверждены",
    failDetail: "Реквизиты счёта не подтверждены",
    missingDetail: "Нет подтверждения реквизитов счёта",
    riskLevel: "high",
    source: LAW_44_ART_43,
  }),
  conditionalEvidenceRule({
    id: "common.participant.major_transaction",
    article: "ст. 31, 43",
    condition: "Закупка требует одобрения крупной сделки",
    requiredDocument: "Решение об одобрении крупной сделки",
    requiredField: "majorTransactionRequired",
    evidenceField: "majorTransactionApproved",
    notRequiredDetail: "Одобрение крупной сделки не требуется",
    requiredMissingDetail: "Не определено, требуется ли одобрение крупной сделки",
    passDetail: "Одобрение крупной сделки подтверждено",
    failDetail: "Одобрение крупной сделки не подтверждено",
    missingDetail: "Нет подтверждения одобрения крупной сделки",
    riskLevel: "high",
    source: LAW_44,
  }),
  conditionalEvidenceRule({
    id: "common.participant.experience",
    article: "ст. 31",
    condition: "Закупка устанавливает требование к опыту участника",
    requiredDocument: "Документы, подтверждающие опыт",
    requiredField: "experienceRequired",
    evidenceField: "experienceConfirmed",
    notRequiredDetail: "Требование к опыту не установлено",
    requiredMissingDetail: "Не определено, установлено ли требование к опыту",
    passDetail: "Опыт участника подтверждён",
    failDetail: "Опыт участника не подтверждён",
    missingDetail: "Нет подтверждения опыта участника",
    riskLevel: "high",
    source: LAW_44,
  }),
  conditionalEvidenceRule({
    id: "common.participant.smp_status",
    article: "ст. 30",
    condition: "Закупка ограничена для СМП/СОНКО",
    requiredDocument: "Подтверждение статуса СМП/СОНКО",
    requiredField: "smpStatusRequired",
    evidenceField: "smpStatusConfirmed",
    notRequiredDetail: "Ограничение для СМП/СОНКО не применяется",
    requiredMissingDetail: "Не определено, применяется ли ограничение для СМП/СОНКО",
    passDetail: "Статус СМП/СОНКО подтверждён",
    failDetail: "Статус СМП/СОНКО не подтверждён",
    missingDetail: "Нет подтверждения статуса СМП/СОНКО",
    riskLevel: "high",
    source: LAW_44,
  }),
];
