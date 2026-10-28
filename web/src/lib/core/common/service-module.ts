import { matchCharacteristics } from "./characteristics.ts";
import {
  antidumpingRule,
  applicationSecurityRule,
  contractSecurityRule,
  deadlineRule,
  law44Rule,
  lowRiskRule,
  marginRule,
  noBlockersRule,
} from "./goods.ts";
import { participantFields, participantRules } from "./participant.ts";
import { serviceScheduleRule } from "./service.ts";
import type { EvidenceValue, FlowContext, FlowEdge, FlowModule, FlowNode, RiskLevel, Rule, RuleEvaluation } from "../flow/types.ts";

export type ServiceExtraCheck = {
  id: string;
  ruleId: string;
  label: string;
  failTo: "report" | "reject";
};

export type ServiceModuleConfig = {
  key: string;
  name: string;
  version: string;
  serviceKind: string;
  serviceLabel: string;
  template: string;
  extraFields?: string[];
  extraRules?: Rule[];
  extraChecks?: ServiceExtraCheck[];
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

const serviceKindRule = (config: ServiceModuleConfig): Rule => ({
  id: `${config.key}.service_kind`,
  law: "internal",
  article: "scope",
  condition: `Объект закупки — ${config.serviceLabel}`,
  requiredDocument: null,
  validationLogic: `serviceKind === '${config.serviceKind}'`,
  riskLevel: "high",
  effectiveFrom: "2026-10-26",
  source: INTERNAL,
  status: "seed",
  evaluate: (context) => {
    const kind = textField(context, "serviceKind");
    if (!kind) return needs("serviceKind", "Не определён тип услуги");
    if (kind === config.serviceKind) return pass(`Объект закупки: ${config.serviceLabel}`);
    return fail(`Объект закупки не относится к категории «${config.serviceLabel}»: ${kind}`);
  },
});

const characteristicsRule = (config: ServiceModuleConfig): Rule => {
  const evidenceKey = `${config.key}ServiceMatch`;
  return {
    id: `${config.key}.characteristics`,
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: `Характеристики услуг «${config.serviceLabel}» соответствуют ТЗ`,
    requiredDocument: "Таблица требований к услугам",
    validationLogic: `построчное сопоставление; иначе ${evidenceKey}`,
    riskLevel: "blocker",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const required = field(context, "requiredServiceCharacteristics");
      const offered = field(context, "offeredServiceCharacteristics");
      if (Array.isArray(required) || Array.isArray(offered)) {
        const result = matchCharacteristics(required, offered);
        if (result.missing.length > 0) return needs(result.missing[0], "Нужны требования ТЗ и характеристики услуги");
        if (!result.matched) {
          const names = result.mismatches.map((item) => item.name).join(", ");
          return fail(`Расхождения по требованиям к услуге: ${names}`);
        }
        return pass("Требования к услуге сопоставлены построчно");
      }
      const match = evidencedBoolean(context, evidenceKey);
      if (match === null) return needs(evidenceKey, "Нет подтверждённого сопоставления требований к услуге");
      if (!match) return fail("Требования к услуге не соответствуют ТЗ");
      return pass("Требования к услуге соответствуют ТЗ");
    },
  };
};

function buildRules(config: ServiceModuleConfig): Rule[] {
  return [
    ...participantRules,
    law44Rule(`${config.key}.law_44fz`),
    serviceKindRule(config),
    deadlineRule(`${config.key}.deadline`),
    characteristicsRule(config),
    serviceScheduleRule(`${config.key}.schedule`),
    applicationSecurityRule(`${config.key}.security.application`),
    contractSecurityRule(`${config.key}.security.contract`),
    marginRule(`${config.key}.margin`),
    antidumpingRule(`${config.key}.antidumping`),
    noBlockersRule(`${config.key}.blockers`),
    lowRiskRule(`${config.key}.low_risk`),
    ...(config.extraRules ?? []),
  ];
}

function buildNodes(config: ServiceModuleConfig): FlowNode[] {
  return [
    {
      id: "parse.notice",
      type: "extract",
      fields: ["law", "nmck", "subject", "submissionDeadline"],
      source: "required",
      label: "Разбор извещения",
    },
    {
      id: "parse.service",
      type: "extract",
      fields: [
        "serviceKind",
        "requiredServiceCharacteristics",
        "offeredServiceCharacteristics",
        `${config.key}ServiceMatch`,
        ...(config.extraFields ?? []),
      ],
      source: "optional",
      label: "Разбор услуги",
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
        "travelCost",
        "subcontractCost",
        "otherCost",
        "serviceRequiredDate",
        "serviceOfferedDate",
        "maxServiceDays",
        "serviceDays",
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
      id: "check.service_kind",
      type: "check",
      ruleId: `${config.key}.service_kind`,
      label: "Проверка типа услуги",
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
      label: "Проверка требований к услуге",
    },
    {
      id: "check.schedule",
      type: "check",
      ruleId: `${config.key}.schedule`,
      label: "Проверка срока оказания услуг",
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
        const costFields = ["travelCost", "subcontractCost", "otherCost"];
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
    ...(config.extraChecks ?? []).map((check): FlowNode => ({
      id: check.id,
      type: "check",
      ruleId: check.ruleId,
      label: check.label,
    })),
  ];
}

const BASE_EDGES: FlowEdge[] = [
  { from: "parse.notice", to: "parse.service", on: "always" },
  { from: "parse.service", to: "parse.commercial", on: "always" },
  { from: "parse.commercial", to: "check.law", on: "always" },
  { from: "check.law", to: "check.service_kind", on: "yes" },
  { from: "check.law", to: "report.risk", on: "no" },
  { from: "check.service_kind", to: "check.deadline", on: "yes" },
  { from: "check.service_kind", to: "report.risk", on: "no" },
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
  { from: "check.characteristics", to: "check.schedule", on: "yes" },
  { from: "check.characteristics", to: "decision.reject", on: "no" },
  { from: "check.schedule", to: "check.security_application", on: "yes" },
  { from: "check.schedule", to: "report.risk", on: "no" },
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

function buildEdges(config: ServiceModuleConfig): FlowEdge[] {
  const edges = BASE_EDGES.map((edge) => ({ ...edge }));
  const checks = config.extraChecks ?? [];
  const first = checks[0];
  if (!first) return edges;

  const passEdgeIndex = edges.findIndex(
    (edge) => edge.from === "check.characteristics" && edge.on === "yes",
  );
  const next = edges[passEdgeIndex]?.to;
  if (passEdgeIndex < 0 || !next) return edges;
  edges.splice(passEdgeIndex, 1);
  edges.push({ from: "check.characteristics", to: first.id, on: "yes" });
  for (let index = 0; index < checks.length; index += 1) {
    const check = checks[index];
    if (!check) continue;
    const nextCheck = checks[index + 1];
    const onPass = nextCheck ? nextCheck.id : next;
    edges.push({ from: check.id, to: onPass, on: "yes" });
    edges.push({
      from: check.id,
      to: check.failTo === "reject" ? "decision.reject" : "report.risk",
      on: "no",
    });
  }
  return edges;
}

export function createServiceModule(config: ServiceModuleConfig): FlowModule {
  return {
    key: config.key,
    name: config.name,
    version: config.version,
    start: "parse.notice",
    nodes: buildNodes(config),
    edges: buildEdges(config),
    rules: buildRules(config),
  };
}
