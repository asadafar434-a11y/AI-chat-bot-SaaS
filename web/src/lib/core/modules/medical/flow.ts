import { participantFields } from "../../common/participant.ts";
import type { FlowContext, FlowEdge, FlowModule, FlowNode, RiskLevel } from "../../flow/types.ts";
import { medicalManifest } from "./manifest.ts";
import { medicalRules } from "./rules.ts";

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
      "isMedicalDevice",
      "registrationCertificate",
      "registrationCoversModel",
      "registrationModel",
      "registrationManufacturer",
      "manufacturer",
      "model",
      "nationalRegimeApplies",
      "countryOfOrigin",
      "originConfirmed",
      "characteristicsMatch",
      "requiredCharacteristics",
      "productCharacteristics",
      "medicineRegistration",
      "medicineRegistrationRecord",
      "medicineRegistrationMatches",
      "medicineName",
      "medicineForm",
      "medicineDosage",
      "medicineManufacturer",
      "medicineCharacteristicsMatch",
      "zhvnlpApplies",
      "zhvnlpMaxPrice",
      "vatRateExpected",
      "vatRate",
      "priceRegistrationRequired",
      "priceRegistrationConfirmed",
      "markupLimitApplies",
      "wholesaleMarkupPercent",
      "maxWholesaleMarkupPercent",
      "shelfLifeRequired",
      "requiredShelfLifeMonths",
      "shelfLifeMonths",
      "coldChainRequired",
      "coldChainConfirmed",
      "markingRequired",
      "markingConfirmed",
      "pharmacyLicenseRequired",
      "pharmacyLicense",
      "registryEntry",
      "registryRecord",
      "technicalPassport",
      "manualRussian",
      "completenessConfirmed",
    ],
    source: "optional",
    label: "Разбор товара",
  },
  {
    id: "parse.commercial",
    type: "extract",
    fields: [
      "participantDeclaration",
      ...participantFields,
      "passportRequired",
      "manualRequired",
      "conformityRequired",
      "conformityDocument",
      "verificationRequired",
      "verificationDocument",
      "installationRequired",
      "installationIncluded",
      "warrantyRequired",
      "warrantyIncluded",
      "dealerAuthorizationRequired",
      "dealerAuthorization",
      "qualityCertificateRequired",
      "qualityCertificate",
      "maintenanceRequired",
      "maintenanceLicense",
      "medicalActivityRequired",
      "medicalActivityLicense",
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
      "coldChainCost",
      "otherCost",
      "deliveryTerms",
      "warrantyTerms",
    ],
    source: "optional",
    label: "Разбор коммерческих условий",
  },
  {
    id: "check.law",
    type: "check",
    ruleId: "internal.law_44fz",
    label: "Проверка закона закупки",
  },
  {
    id: "check.product_kind",
    type: "check",
    ruleId: "internal.product_kind_known",
    label: "Проверка типа объекта",
  },
  {
    id: "check.deadline",
    type: "check",
    ruleId: "internal.deadline",
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
    id: "question.product_kind",
    type: "question",
    question: "Что закупается: медизделие или лекарство?",
    answer: "choice",
    field: "productKind",
    label: "Выбор ветки",
  },
  {
    id: "check.registration",
    type: "check",
    ruleId: "medical.registration.required",
    label: "Проверка регистрационного удостоверения",
  },
  {
    id: "check.registration_matches",
    type: "check",
    ruleId: "medical.registration.matches",
    label: "Проверка соответствия РУ модели",
  },
  {
    id: "check.national_regime",
    type: "check",
    ruleId: "medical.national_regime",
    label: "Проверка национального режима",
  },
  {
    id: "check.participant_declaration",
    type: "check",
    ruleId: "medical.participant_declaration",
    label: "Проверка декларации участника",
  },
  {
    id: "check.characteristics",
    type: "check",
    ruleId: "medical.characteristics",
    label: "Проверка характеристик",
  },
  {
    id: "check.device_registry",
    type: "check",
    ruleId: "medical.device.registry_entry",
    label: "Проверка записи в реестре",
  },
  {
    id: "check.device_passport",
    type: "check",
    ruleId: "medical.device.passport",
    label: "Проверка технического паспорта",
  },
  {
    id: "check.device_manual",
    type: "check",
    ruleId: "medical.device.manual",
    label: "Проверка руководства по эксплуатации",
  },
  {
    id: "check.device_completeness",
    type: "check",
    ruleId: "medical.device.completeness",
    label: "Проверка комплектности",
  },
  {
    id: "check.device_conformity",
    type: "check",
    ruleId: "medical.device.conformity",
    label: "Проверка декларации или сертификата",
  },
  {
    id: "check.device_verification",
    type: "check",
    ruleId: "medical.device.verification",
    label: "Проверка поверки",
  },
  {
    id: "check.device_installation",
    type: "check",
    ruleId: "medical.device.installation",
    label: "Проверка монтажа и ввода в эксплуатацию",
  },
  {
    id: "check.device_warranty",
    type: "check",
    ruleId: "medical.device.warranty",
    label: "Проверка гарантии",
  },
  {
    id: "check.device_dealer",
    type: "check",
    ruleId: "medical.device.dealer_authorization",
    label: "Проверка дилерских полномочий",
  },
  {
    id: "check.device_quality",
    type: "check",
    ruleId: "medical.device.quality_management",
    label: "Проверка сертификата СМК",
  },
  {
    id: "check.license_maintenance",
    type: "check",
    ruleId: "medical.license.maintenance",
    label: "Проверка лицензии на ТО",
  },
  {
    id: "check.license_activity",
    type: "check",
    ruleId: "medical.license.activity",
    label: "Проверка лицензии на медицинскую деятельность",
  },
  {
    id: "check.medicine_registration",
    type: "check",
    ruleId: "medicine.registration.required",
    label: "Проверка РУ лекарственного препарата",
  },
  {
    id: "check.medicine_registration_matches",
    type: "check",
    ruleId: "medicine.registration.matches",
    label: "Проверка соответствия РУ препарату",
  },
  {
    id: "check.medicine_characteristics",
    type: "check",
    ruleId: "medicine.characteristics",
    label: "Проверка характеристик препарата",
  },
  {
    id: "check.medicine_zhvnlp",
    type: "check",
    ruleId: "medicine.zhvnlp",
    label: "Проверка цены ЖНВЛП",
  },
  {
    id: "check.medicine_vat",
    type: "check",
    ruleId: "medicine.vat_rate",
    label: "Проверка ставки НДС",
  },
  {
    id: "check.medicine_price_registration",
    type: "check",
    ruleId: "medicine.price_registration",
    label: "Проверка регистрации цены",
  },
  {
    id: "check.medicine_markup",
    type: "check",
    ruleId: "medicine.markup",
    label: "Проверка оптовой надбавки",
  },
  {
    id: "check.medicine_shelf_life",
    type: "check",
    ruleId: "medicine.shelf_life",
    label: "Проверка остаточного срока годности",
  },
  {
    id: "check.medicine_cold_chain",
    type: "check",
    ruleId: "medicine.cold_chain",
    label: "Проверка холодовой цепи",
  },
  {
    id: "check.medicine_marking",
    type: "check",
    ruleId: "medicine.marking",
    label: "Проверка маркировки",
  },
  {
    id: "check.medicine_license",
    type: "check",
    ruleId: "medicine.license",
    label: "Проверка лицензии на фармацевтическую деятельность",
  },
  {
    id: "check.security_application",
    type: "check",
    ruleId: "medical.security.application",
    label: "Проверка обеспечения заявки",
  },
  {
    id: "check.security_contract",
    type: "check",
    ruleId: "medical.security.contract",
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
      const costFields = ["logisticsCost", "installationCost", "warrantyCost", "coldChainCost", "otherCost"];
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
    ruleId: "medical.margin",
    label: "Проверка маржи",
  },
  {
    id: "check.antidumping",
    type: "check",
    ruleId: "medical.antidumping",
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
    ruleId: "internal.no_blockers",
    label: "Проверка блокирующих нарушений",
  },
  {
    id: "check.low_risk",
    type: "check",
    ruleId: "internal.low_risk",
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
    label: "Подготовка заявки ИИ",
    template: "medical-application",
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
  { from: "check.common_smp_status", to: "question.product_kind", on: "yes" },
  { from: "check.common_smp_status", to: "report.risk", on: "no" },
  { from: "question.product_kind", to: "check.registration", on: "value", value: "device" },
  { from: "question.product_kind", to: "check.medicine_registration", on: "value", value: "medicine" },
  { from: "check.registration", to: "check.registration_matches", on: "yes" },
  { from: "check.registration", to: "decision.reject", on: "no" },
  { from: "check.registration_matches", to: "check.national_regime", on: "yes" },
  { from: "check.registration_matches", to: "decision.reject", on: "no" },
  { from: "check.national_regime", to: "check.participant_declaration", on: "yes" },
  { from: "check.national_regime", to: "report.risk", on: "no" },
  { from: "check.participant_declaration", to: "check.characteristics", on: "yes" },
  { from: "check.participant_declaration", to: "decision.reject", on: "no" },
  { from: "check.characteristics", to: "check.device_registry", on: "yes" },
  { from: "check.characteristics", to: "decision.reject", on: "no" },
  { from: "check.device_registry", to: "check.device_passport", on: "yes" },
  { from: "check.device_registry", to: "report.risk", on: "no" },
  { from: "check.device_passport", to: "check.device_manual", on: "yes" },
  { from: "check.device_passport", to: "report.risk", on: "no" },
  { from: "check.device_manual", to: "check.device_completeness", on: "yes" },
  { from: "check.device_manual", to: "report.risk", on: "no" },
  { from: "check.device_completeness", to: "check.device_conformity", on: "yes" },
  { from: "check.device_completeness", to: "decision.reject", on: "no" },
  { from: "check.device_conformity", to: "check.device_verification", on: "yes" },
  { from: "check.device_conformity", to: "decision.reject", on: "no" },
  { from: "check.device_verification", to: "check.device_installation", on: "yes" },
  { from: "check.device_verification", to: "report.risk", on: "no" },
  { from: "check.device_installation", to: "check.device_warranty", on: "yes" },
  { from: "check.device_installation", to: "report.risk", on: "no" },
  { from: "check.device_warranty", to: "check.device_dealer", on: "yes" },
  { from: "check.device_warranty", to: "report.risk", on: "no" },
  { from: "check.device_dealer", to: "check.device_quality", on: "yes" },
  { from: "check.device_dealer", to: "report.risk", on: "no" },
  { from: "check.device_quality", to: "check.license_maintenance", on: "yes" },
  { from: "check.device_quality", to: "report.risk", on: "no" },
  { from: "check.license_maintenance", to: "check.license_activity", on: "yes" },
  { from: "check.license_maintenance", to: "report.risk", on: "no" },
  { from: "check.license_activity", to: "check.security_application", on: "yes" },
  { from: "check.license_activity", to: "report.risk", on: "no" },
  { from: "check.medicine_registration", to: "check.medicine_registration_matches", on: "yes" },
  { from: "check.medicine_registration", to: "decision.reject", on: "no" },
  { from: "check.medicine_registration_matches", to: "check.medicine_characteristics", on: "yes" },
  { from: "check.medicine_registration_matches", to: "decision.reject", on: "no" },
  { from: "check.medicine_characteristics", to: "check.medicine_zhvnlp", on: "yes" },
  { from: "check.medicine_characteristics", to: "decision.reject", on: "no" },
  { from: "check.medicine_zhvnlp", to: "check.medicine_vat", on: "yes" },
  { from: "check.medicine_zhvnlp", to: "report.risk", on: "no" },
  { from: "check.medicine_vat", to: "check.medicine_price_registration", on: "yes" },
  { from: "check.medicine_vat", to: "report.risk", on: "no" },
  { from: "check.medicine_price_registration", to: "check.medicine_markup", on: "yes" },
  { from: "check.medicine_price_registration", to: "report.risk", on: "no" },
  { from: "check.medicine_markup", to: "check.medicine_shelf_life", on: "yes" },
  { from: "check.medicine_markup", to: "report.risk", on: "no" },
  { from: "check.medicine_shelf_life", to: "check.medicine_cold_chain", on: "yes" },
  { from: "check.medicine_shelf_life", to: "report.risk", on: "no" },
  { from: "check.medicine_cold_chain", to: "check.medicine_marking", on: "yes" },
  { from: "check.medicine_cold_chain", to: "report.risk", on: "no" },
  { from: "check.medicine_marking", to: "check.medicine_license", on: "yes" },
  { from: "check.medicine_marking", to: "report.risk", on: "no" },
  { from: "check.medicine_license", to: "check.security_application", on: "yes" },
  { from: "check.medicine_license", to: "report.risk", on: "no" },
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

export const medicalModule: FlowModule = {
  ...medicalManifest,
  start: "parse.notice",
  nodes,
  edges,
  rules: medicalRules,
};
