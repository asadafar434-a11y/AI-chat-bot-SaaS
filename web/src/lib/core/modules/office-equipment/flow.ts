import { participantFields } from "../../common/participant.ts";
import type { FlowContext, FlowEdge, FlowModule, FlowNode, RiskLevel } from "../../flow/types.ts";
import { officeManifest } from "./manifest.ts";
import { officeRules } from "./rules.ts";

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

const RISK_WEIGHTS: Record<RiskLevel, number> = {
  blocker: 100,
  high: 40,
  medium: 15,
  low: 5,
};

const nodes: FlowNode[] = [
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
      "officeCharacteristicsMatch",
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
    ruleId: "office.law_44fz",
    label: "Проверка закона закупки",
  },
  {
    id: "check.product_kind",
    type: "check",
    ruleId: "office.product_kind",
    label: "Проверка типа объекта",
  },
  {
    id: "check.deadline",
    type: "check",
    ruleId: "office.deadline",
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
    ruleId: "office.characteristics",
    label: "Проверка характеристик",
  },
  {
    id: "check.warranty",
    type: "check",
    ruleId: "office.warranty",
    label: "Проверка гарантии",
  },
  {
    id: "check.delivery_schedule",
    type: "check",
    ruleId: "office.delivery_schedule",
    label: "Проверка срока поставки",
  },
  {
    id: "check.security_application",
    type: "check",
    ruleId: "office.security.application",
    label: "Проверка обеспечения заявки",
  },
  {
    id: "check.security_contract",
    type: "check",
    ruleId: "office.security.contract",
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
    ruleId: "office.margin",
    label: "Проверка маржи",
  },
  {
    id: "check.antidumping",
    type: "check",
    ruleId: "office.antidumping",
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
    ruleId: "office.blockers",
    label: "Проверка блокирующих нарушений",
  },
  {
    id: "check.low_risk",
    type: "check",
    ruleId: "office.low_risk",
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
    template: "office-application",
  },
];

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

export const officeModule: FlowModule = {
  ...officeManifest,
  start: "parse.notice",
  nodes,
  edges,
  rules: officeRules,
};
