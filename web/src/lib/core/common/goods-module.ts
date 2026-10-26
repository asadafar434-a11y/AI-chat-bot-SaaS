import { matchCharacteristics } from "./characteristics.ts";
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
} from "./goods.ts";
import { participantFields, participantRules } from "./participant.ts";
import type { EvidenceValue, FlowContext, FlowEdge, FlowModule, FlowNode, RiskLevel, Rule, RuleEvaluation } from "../flow/types.ts";

export type GoodsModuleConfig = {
  key: string;
  name: string;
  version: string;
  productKind: string;
  productLabel: string;
  template: string;
};

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

const RISK_WEIGHTS: Record<RiskLevel, number> = {
  blocker: 100,
  high: 40,
  medium: 15,
  low: 5,
};

const readValue = (context: FlowContext, key: string): unknown => {
  if (Object.prototype.hasOwnProperty.call(context.outputs, key)) return context.outputs[key];
  return context.input.data[key];
};

const readNumber = (context: FlowContext, key: string): number | null => {
  const value = readValue(context, key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const productKindRule = (config: GoodsModuleConfig): Rule => ({
  id: `${config.key}.product_kind`,
  law: "internal",
  article: "scope",
  condition: `Объект закупки — ${config.productLabel}`,
  requiredDocument: null,
  validationLogic: `productKind === '${config.productKind}'`,
  riskLevel: "high",
  effectiveFrom: "2026-10-26",
  source: INTERNAL,
  status: "seed",
  evaluate: (context) => {
    const kind = textField(context, "productKind");
    if (!kind) return needs("productKind", "Не определён тип объекта закупки");
    if (kind === config.productKind) return pass(`Объект закупки: ${config.productLabel}`);
    return fail(`Объект закупки не относится к категории «${config.productLabel}»: ${kind}`);
  },
});

const characteristicsRule = (config: GoodsModuleConfig, evidenceKey: string): Rule => ({
  id: `${config.key}.characteristics`,
  law: "44-ФЗ",
  article: "ст. 33, 43",
  condition: `Характеристики ${config.productLabel} соответствуют ТЗ`,
  requiredDocument: "Таблица характеристик по ТЗ",
  validationLogic: `построчное сопоставление; иначе ${evidenceKey}`,
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
    const match = evidencedBoolean(context, evidenceKey);
    if (match === null) return needs(evidenceKey, "Нет подтверждённого сопоставления характеристик");
    if (!match) return fail("Характеристики не соответствуют ТЗ");
    return pass("Характеристики соответствуют ТЗ");
  },
});

const warrantyRule = (config: GoodsModuleConfig): Rule => ({
  id: `${config.key}.warranty`,
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
});

function buildRules(config: GoodsModuleConfig): Rule[] {
  const characteristicsEvidence = `${config.key}CharacteristicsMatch`;
  return [
    ...participantRules,
    law44Rule(`${config.key}.law_44fz`),
    productKindRule(config),
    deadlineRule(`${config.key}.deadline`),
    characteristicsRule(config, characteristicsEvidence),
    warrantyRule(config),
    deliveryScheduleRule(`${config.key}.delivery_schedule`),
    applicationSecurityRule(`${config.key}.security.application`),
    contractSecurityRule(`${config.key}.security.contract`),
    marginRule(`${config.key}.margin`),
    antidumpingRule(`${config.key}.antidumping`),
    noBlockersRule(`${config.key}.blockers`),
    lowRiskRule(`${config.key}.low_risk`),
  ];
}

function buildNodes(config: GoodsModuleConfig): FlowNode[] {
  const characteristicsEvidence = `${config.key}CharacteristicsMatch`;
  return [
    {
      id: "parse.notice",
      type: "extract",
      fields: ["law", "nmck", "subject", "submissionDeadline"],
      source: "required",
      label: "Разбор извещения",
    },
    {
      id: "parse.product",
      type: "extract",
      fields: [
        "productKind",
        "requiredCharacteristics",
        "productCharacteristics",
        characteristicsEvidence,
        "warrantyRequired",
        "warrantyIncluded",
      ],
      source: "optional",
      label: "Разбор товара",
    },
    {
      id: "parse.commercial",
      type: "extract",
      fields: [
        ...participantFields,
        "applicationSecurityRequired",
        "applicationSecurityProvided",
        "applicationSecurityRequiredAmount",
        "applicationSecurityAmount",
        "applicationSecurityFormRequired",
        "applicationSecurityForm",
        "applicationSecurityRequiredUntil",
        "applicationSecurityValidUntil",
        "contractSecurityRequired",
        "contractSecurityProvided",
        "contractSecurityRequiredAmount",
        "contractSecurityAmount",
        "contractSecurityFormRequired",
        "contractSecurityForm",
        "contractSecurityRequiredUntil",
        "contractSecurityValidUntil",
        "antidumpingSecurityProvided",
        "priceJustificationProvided",
        "cost",
        "offerPrice",
        "logisticsCost",
        "installationCost",
        "warrantyCost",
        "otherCost",
        "deliveryRequiredDate",
        "deliveryOfferedDate",
        "maxDeliveryDays",
        "deliveryDays",
      ],
      source: "optional",
      label: "Разбор коммерческих условий",
    },
    {
      id: "check.law",
      type: "check",
      ruleId: `${config.key}.law_44fz`,
      label: "Проверка закона закупки",
    },
    {
      id: "check.product_kind",
      type: "check",
      ruleId: `${config.key}.product_kind`,
      label: "Проверка типа объекта",
    },
    {
      id: "check.deadline",
      type: "check",
      ruleId: `${config.key}.deadline`,
      label: "Проверка срока подачи",
    },
    {
      id: "check.common_registration",
      type: "check",
      ruleId: "common.participant.registration",
      label: "Проверка регистрации участника",
    },
    {
      id: "check.common_signatory",
      type: "check",
      ruleId: "common.participant.signatory",
      label: "Проверка полномочий подписанта",
    },
    {
      id: "check.common_restrictions",
      type: "check",
      ruleId: "common.participant.restrictions",
      label: "Проверка ограничений участника",
    },
    {
      id: "check.common_bank_details",
      type: "check",
      ruleId: "common.participant.bank_details",
      label: "Проверка реквизитов счёта",
    },
    {
      id: "check.common_major_transaction",
      type: "check",
      ruleId: "common.participant.major_transaction",
      label: "Проверка одобрения крупной сделки",
    },
    {
      id: "check.common_experience",
      type: "check",
      ruleId: "common.participant.experience",
      label: "Проверка опыта участника",
    },
    {
      id: "check.common_smp_status",
      type: "check",
      ruleId: "common.participant.smp_status",
      label: "Проверка статуса СМП/СОНКО",
    },
    {
      id: "check.characteristics",
      type: "check",
      ruleId: `${config.key}.characteristics`,
      label: "Проверка характеристик",
    },
    {
      id: "check.warranty",
      type: "check",
      ruleId: `${config.key}.warranty`,
      label: "Проверка гарантии",
    },
    {
      id: "check.delivery_schedule",
      type: "check",
      ruleId: `${config.key}.delivery_schedule`,
      label: "Проверка срока поставки",
    },
    {
      id: "check.security_application",
      type: "check",
      ruleId: `${config.key}.security.application`,
      label: "Проверка обеспечения заявки",
    },
    {
      id: "check.security_contract",
      type: "check",
      ruleId: `${config.key}.security.contract`,
      label: "Проверка обеспечения контракта",
    },
    {
      id: "calc.price",
      type: "calc",
      label: "Расчёт цены и маржи",
      compute: (context) => {
        const cost = readNumber(context, "cost");
        const offerPrice = readNumber(context, "offerPrice");
        const nmck = readNumber(context, "nmck");
        if (cost === null || offerPrice === null || nmck === null) {
          const missing = [
            ...(cost === null ? ["cost"] : []),
            ...(offerPrice === null ? ["offerPrice"] : []),
            ...(nmck === null ? ["nmck"] : []),
          ];
          return { outputs: {}, missing, detail: "Недостаточно данных для расчёта цены" };
        }
        const costFields = ["logisticsCost", "installationCost", "warrantyCost", "otherCost"];
        let additionalCosts = 0;
        const invalidCosts: string[] = [];
        for (const key of costFields) {
          const value = readValue(context, key);
          if (value === undefined || value === null || (typeof value === "string" && value.trim().length === 0)) continue;
          const parsed = readNumber(context, key);
          if (parsed === null) {
            invalidCosts.push(key);
            continue;
          }
          additionalCosts += parsed;
        }
        if (invalidCosts.length > 0) {
          return { outputs: {}, missing: invalidCosts, detail: "Некорректные дополнительные затраты" };
        }
        const totalCost = cost + additionalCosts;
        const margin = offerPrice - totalCost;
        const marginPercent = offerPrice > 0 ? (margin / offerPrice) * 100 : null;
        const antidumpingThreshold = nmck * 0.75;
        return {
          outputs: { additionalCosts, totalCost, margin, marginPercent, antidumpingThreshold },
          detail: `Себестоимость: ${totalCost}, маржа: ${margin}, порог антидемпинга: ${antidumpingThreshold}`,
        };
      },
    },
    {
      id: "check.margin",
      type: "check",
      ruleId: `${config.key}.margin`,
      label: "Проверка маржи",
    },
    {
      id: "check.antidumping",
      type: "check",
      ruleId: `${config.key}.antidumping`,
      label: "Проверка антидемпинга",
    },
    {
      id: "score.risk",
      type: "score",
      label: "Скоринг рисков",
      compute: (context) => {
        let score = 0;
        for (const finding of context.findings) {
          if (finding.status !== "failed" || finding.riskLevel === null) continue;
          score += RISK_WEIGHTS[finding.riskLevel];
        }
        const riskBand = score >= 100 ? "blocker" : score >= 40 ? "high" : score >= 15 ? "medium" : "low";
        return { outputs: { riskScore: score, riskBand }, detail: `Риск: ${score} (${riskBand})` };
      },
    },
    {
      id: "check.blockers",
      type: "check",
      ruleId: `${config.key}.blockers`,
      label: "Проверка блокирующих нарушений",
    },
    {
      id: "check.low_risk",
      type: "check",
      ruleId: `${config.key}.low_risk`,
      label: "Проверка итогового риска",
    },
    {
      id: "decision.reject",
      type: "decision",
      outcome: "do_not_participate",
      label: "Не участвовать",
    },
    {
      id: "report.risk",
      type: "report",
      label: "Отчёт о рисках",
      reason: "Есть существенные риски или не хватает данных для безопасного участия",
    },
    {
      id: "generate.application",
      type: "generate",
      label: "Подготовка заявки",
      template: config.template,
    },
  ];
}

const edges: FlowEdge[] = [
  { from: "parse.notice", to: "parse.product", on: "always" },
  { from: "parse.product", to: "parse.commercial", on: "always" },
  { from: "parse.commercial", to: "check.law", on: "always" },
  { from: "check.law", to: "check.product_kind", on: "yes" },
  { from: "check.law", to: "report.risk", on: "no" },
  { from: "check.product_kind", to: "check.deadline", on: "yes" },
  { from: "check.product_kind", to: "report.risk", on: "no" },
  { from: "check.deadline", to: "check.common_registration", on: "yes" },
  { from: "check.deadline", to: "decision.reject", on: "no" },
  { from: "check.common_registration", to: "check.common_signatory", on: "yes" },
  { from: "check.common_registration", to: "decision.reject", on: "no" },
  { from: "check.common_signatory", to: "check.common_restrictions", on: "yes" },
  { from: "check.common_signatory", to: "decision.reject", on: "no" },
  { from: "check.common_restrictions", to: "check.common_bank_details", on: "yes" },
  { from: "check.common_restrictions", to: "decision.reject", on: "no" },
  { from: "check.common_bank_details", to: "check.common_major_transaction", on: "yes" },
  { from: "check.common_bank_details", to: "report.risk", on: "no" },
  { from: "check.common_major_transaction", to: "check.common_experience", on: "yes" },
  { from: "check.common_major_transaction", to: "report.risk", on: "no" },
  { from: "check.common_experience", to: "check.common_smp_status", on: "yes" },
  { from: "check.common_experience", to: "report.risk", on: "no" },
  { from: "check.common_smp_status", to: "check.characteristics", on: "yes" },
  { from: "check.common_smp_status", to: "report.risk", on: "no" },
  { from: "check.characteristics", to: "check.warranty", on: "yes" },
  { from: "check.characteristics", to: "decision.reject", on: "no" },
  { from: "check.warranty", to: "check.delivery_schedule", on: "yes" },
  { from: "check.warranty", to: "report.risk", on: "no" },
  { from: "check.delivery_schedule", to: "check.security_application", on: "yes" },
  { from: "check.delivery_schedule", to: "report.risk", on: "no" },
  { from: "check.security_application", to: "check.security_contract", on: "yes" },
  { from: "check.security_application", to: "report.risk", on: "no" },
  { from: "check.security_contract", to: "calc.price", on: "yes" },
  { from: "check.security_contract", to: "report.risk", on: "no" },
  { from: "calc.price", to: "check.margin", on: "always" },
  { from: "check.margin", to: "check.antidumping", on: "yes" },
  { from: "check.margin", to: "report.risk", on: "no" },
  { from: "check.antidumping", to: "score.risk", on: "yes" },
  { from: "check.antidumping", to: "report.risk", on: "no" },
  { from: "score.risk", to: "check.blockers", on: "always" },
  { from: "check.blockers", to: "check.low_risk", on: "yes" },
  { from: "check.blockers", to: "decision.reject", on: "no" },
  { from: "check.low_risk", to: "generate.application", on: "yes" },
  { from: "check.low_risk", to: "report.risk", on: "no" },
];

export function createGoodsModule(config: GoodsModuleConfig): FlowModule {
  return {
    key: config.key,
    name: config.name,
    version: config.version,
    start: "parse.notice",
    nodes: buildNodes(config),
    edges,
    rules: buildRules(config),
  };
}
