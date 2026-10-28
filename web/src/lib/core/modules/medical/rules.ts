import { matchCharacteristics } from "../../common/characteristics.ts";
import { participantRules } from "../../common/participant.ts";
import type { EvidenceValue, FlowContext, Rule, RuleEvaluation } from "../../flow/types.ts";
import { medicineRules } from "./medicine-rules.ts";
import { checkRegistryRecord } from "./registry.ts";

const LAW_44 = "https://www.consultant.ru/document/cons_doc_LAW_144624/";
const LAW_44_ART_43 = "https://www.consultant.ru/document/cons_doc_LAW_144624/5a18b3d46fe0fd48f2482cd6ec7ce419763efccd/";
const LAW_323 = "https://www.consultant.ru/document/cons_doc_LAW_121895/";
const LAW_99 = "https://www.consultant.ru/document/cons_doc_LAW_113658/";
const PP_1875 = "https://www.consultant.ru/document/cons_doc_LAW_494318/92d969e26a4326c5d02fa79b8f9cf4994ee5633b/";
const ROSZDRAV = "https://roszdravnadzor.gov.ru/medproducts/registration/";
const INTERNAL = "Внутренняя политика Core v1";

const EAEU = new Set([
  "RU",
  "RUS",
  "РОССИЯ",
  "РФ",
  "BY",
  "BEL",
  "БЕЛАРУСЬ",
  "KZ",
  "KAZ",
  "КАЗАХСТАН",
  "AM",
  "ARM",
  "АРМЕНИЯ",
  "KG",
  "KGZ",
  "КЫРГЫЗСТАН",
  "КИРГИЗИЯ",
]);

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

const evidencedText = (context: FlowContext, key: string): string | null => {
  const item = evidenceOf(context, key);
  if (!item) return null;
  return typeof item.value === "string" && item.value.trim().length > 0 ? item.value.trim() : null;
};

const evidencedBoolean = (context: FlowContext, key: string): boolean | null => {
  const item = evidenceOf(context, key);
  if (!item) return null;
  return typeof item.value === "boolean" ? item.value : null;
};

const pass = (detail: string): RuleEvaluation => ({ passed: true, detail, missing: [] });
const fail = (detail: string): RuleEvaluation => ({ passed: false, detail, missing: [] });
const needs = (fieldName: string, detail: string): RuleEvaluation => ({ passed: false, detail, missing: [fieldName] });

export const medicalRules: Rule[] = [
  ...participantRules,
  ...medicineRules,
  {
    id: "internal.law_44fz",
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
  },
  {
    id: "internal.product_kind_known",
    law: "internal",
    article: "scope",
    condition: "Объект закупки — лекарство или медизделие",
    requiredDocument: null,
    validationLogic: "productKind ∈ {device, medicine}",
    riskLevel: "high",
    effectiveFrom: "2026-10-26",
    source: INTERNAL,
    status: "seed",
    evaluate: (context) => {
      const kind = textField(context, "productKind");
      if (!kind) return needs("productKind", "Не определено: лекарство или медизделие");
      if (kind === "device") return pass("Объект закупки: медицинское изделие");
      if (kind === "medicine") return pass("Объект закупки: лекарственный препарат");
      return fail(`Неизвестный тип объекта: ${kind}`);
    },
  },
  {
    id: "internal.deadline",
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
  },
  {
    id: "medical.registration.required",
    law: "323-ФЗ",
    article: "ст. 38",
    condition: "Медицинское изделие подлежит государственной регистрации",
    requiredDocument: "Регистрационное удостоверение",
    validationLogic: "isMedicalDevice === true → registrationCertificate подтверждён",
    riskLevel: "blocker",
    effectiveFrom: "2012-01-01",
    source: `${LAW_323} · ${ROSZDRAV}`,
    sourceUrl: LAW_323,
    status: "seed",
    evaluate: (context) => {
      const isDevice = booleanField(context, "isMedicalDevice");
      if (isDevice === null) return needs("isMedicalDevice", "Не определено, является ли товар медицинским изделием");
      if (!isDevice) return pass("Товар не является медицинским изделием");
      const certificate = evidencedText(context, "registrationCertificate");
      if (!certificate) return needs("registrationCertificate", "Не подтверждено регистрационное удостоверение");
      return pass(`РУ: ${certificate}`);
    },
  },
  {
    id: "medical.registration.matches",
    law: "323-ФЗ",
    article: "ст. 38",
    condition: "РУ покрывает предложенную модель и производителя",
    requiredDocument: "Регистрационное удостоверение с приложением",
    validationLogic: "registryRecord сверяется с РУ, моделью и производителем; иначе registrationCoversModel",
    riskLevel: "blocker",
    effectiveFrom: "2012-01-01",
    source: ROSZDRAV,
    status: "seed",
    evaluate: (context) => {
      const isDevice = booleanField(context, "isMedicalDevice");
      if (isDevice === null) return needs("isMedicalDevice", "Не определено, является ли товар медицинским изделием");
      if (!isDevice) return pass("Правило не применяется");
      const record = field(context, "registryRecord");
      if (record !== undefined && record !== null) {
        const result = checkRegistryRecord(record, {
          registrationNumber: textField(context, "registrationCertificate") ?? "",
          model: textField(context, "model") ?? undefined,
          manufacturer: textField(context, "manufacturer") ?? undefined,
        });
        if (result.missing.length > 0) return needs(result.missing[0], result.detail);
        if (!result.matched) return fail(result.detail);
        return pass(result.detail);
      }
      const covered = evidencedBoolean(context, "registrationCoversModel");
      if (covered !== null) {
        return covered ? pass("РУ покрывает предложенную модель") : fail("РУ не покрывает предложенную модель");
      }
      const ruModel = textField(context, "registrationModel");
      const ruManufacturer = textField(context, "registrationManufacturer");
      const model = textField(context, "model");
      const manufacturer = textField(context, "manufacturer");
      if (!ruModel || !ruManufacturer || !model || !manufacturer) {
        return needs("registrationCoversModel", "Нужна сверка РУ с моделью и производителем");
      }
      if (ruModel !== model || ruManufacturer !== manufacturer) {
        return fail("Модель или производитель не совпадают с РУ");
      }
      return pass("Модель и производитель совпадают с РУ");
    },
  },
  {
    id: "medical.national_regime",
    law: "ПП РФ № 1875",
    article: "постановление",
    condition: "Применяется национальный режим",
    requiredDocument: "Подтверждение страны происхождения",
    validationLogic: "nationalRegimeApplies === true → countryOfOrigin ∈ ЕАЭС и originConfirmed подтверждён",
    riskLevel: "high",
    effectiveFrom: "2025-01-01",
    source: PP_1875,
    status: "seed",
    evaluate: (context) => {
      const applies = booleanField(context, "nationalRegimeApplies");
      if (applies === null) return needs("nationalRegimeApplies", "Не определено, применяется ли национальный режим");
      if (!applies) return pass("Национальный режим не применяется");
      const country = textField(context, "countryOfOrigin");
      if (!country) return needs("countryOfOrigin", "Не указана страна происхождения");
      const confirmed = evidencedBoolean(context, "originConfirmed");
      if (confirmed === null) return needs("originConfirmed", "Происхождение не подтверждено документом");
      if (!EAEU.has(country.toUpperCase()) || !confirmed) {
        return fail(`Страна происхождения ${country} не подтверждает режим ЕАЭС`);
      }
      return pass(`Происхождение подтверждено: ${country}`);
    },
  },
  {
    id: "medical.participant_declaration",
    law: "44-ФЗ",
    article: "ст. 31, 43",
    condition: "Участник подтверждает соответствие требованиям",
    requiredDocument: "Декларация соответствия участника",
    validationLogic: "law === 44-ФЗ → participantDeclaration подтверждён",
    riskLevel: "blocker",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const law = textField(context, "law");
      if (!law) return needs("law", "Не определён закон закупки");
      if (law.includes("223")) return fail("223-ФЗ не поддерживается в этом модуле");
      if (!law.includes("44")) return fail(`Неизвестный закон закупки: ${law}`);
      const declaration = evidencedBoolean(context, "participantDeclaration");
      if (declaration === null) return needs("participantDeclaration", "Нет подтверждённой декларации участника");
      if (!declaration) return fail("Нет декларации соответствия требованиям участника");
      return pass("Декларация участника подтверждена");
    },
  },
  {
    id: "medical.characteristics",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Характеристики соответствуют техническому заданию",
    requiredDocument: "Таблица характеристик по ТЗ",
    validationLogic: "построчное сопоставление requiredCharacteristics с productCharacteristics; иначе characteristicsMatch",
    riskLevel: "blocker",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const required = field(context, "requiredCharacteristics");
      const offered = field(context, "productCharacteristics");
      if (Array.isArray(required) || Array.isArray(offered)) {
        const result = matchCharacteristics(required, offered);
        if (result.missing.length > 0) {
          return needs(result.missing[0], "Нужны требования ТЗ и характеристики товара для построчной сверки");
        }
        if (!result.matched) {
          const names = result.mismatches.map((item) => item.name).join(", ");
          return fail(`Расхождения по характеристикам: ${names}`);
        }
        return pass("Характеристики сопоставлены построчно");
      }
      const match = evidencedBoolean(context, "characteristicsMatch");
      if (match === null) return needs("characteristicsMatch", "Нет подтверждённого сопоставления характеристик");
      if (!match) return fail("Характеристики не соответствуют ТЗ");
      return pass("Характеристики соответствуют ТЗ");
    },
  },
  {
    id: "medical.device.registry_entry",
    law: "323-ФЗ",
    article: "ст. 38",
    condition: "Медизделие включено в государственный реестр",
    requiredDocument: "Запись в государственном реестре медицинских изделий",
    validationLogic: "registryRecord.active и совпадение РУ/модели/производителя; иначе registryEntry",
    riskLevel: "high",
    effectiveFrom: "2012-01-01",
    source: `${LAW_323} · ${ROSZDRAV}`,
    sourceUrl: ROSZDRAV,
    status: "seed",
    evaluate: (context) => {
      const isDevice = booleanField(context, "isMedicalDevice");
      if (isDevice === null) return needs("isMedicalDevice", "Не определено, является ли товар медицинским изделием");
      if (!isDevice) return pass("Правило не применяется");
      const record = field(context, "registryRecord");
      if (record !== undefined && record !== null) {
        const registrationNumber = textField(context, "registrationCertificate");
        if (!registrationNumber) return needs("registrationCertificate", "Не указано РУ для сверки с реестром");
        const result = checkRegistryRecord(record, {
          registrationNumber,
          model: textField(context, "model") ?? undefined,
          manufacturer: textField(context, "manufacturer") ?? undefined,
        });
        if (result.missing.length > 0) return needs(result.missing[0], result.detail);
        if (!result.matched) return fail(result.detail);
        return pass(result.detail);
      }
      const entry = evidencedBoolean(context, "registryEntry");
      if (entry === null) return needs("registryEntry", "Нет подтверждения записи в реестре");
      if (!entry) return fail("Медизделие не подтверждено записью в реестре");
      return pass("Запись в реестре подтверждена");
    },
  },
  {
    id: "medical.device.passport",
    law: "44-ФЗ",
    article: "ст. 43",
    condition: "Технический паспорт требуется условиями закупки",
    requiredDocument: "Технический паспорт",
    validationLogic: "passportRequired === true → technicalPassport подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "passportRequired");
      if (required === null) return needs("passportRequired", "Не определено, требуется ли технический паспорт");
      if (!required) return pass("Технический паспорт не требуется");
      const passport = evidencedBoolean(context, "technicalPassport");
      if (passport === null) return needs("technicalPassport", "Нет подтверждения технического паспорта");
      if (!passport) return fail("Технический паспорт не подтверждён");
      return pass("Технический паспорт подтверждён");
    },
  },
  {
    id: "medical.device.manual",
    law: "44-ФЗ",
    article: "ст. 43",
    condition: "Руководство по эксплуатации требуется условиями закупки",
    requiredDocument: "Руководство по эксплуатации на русском языке",
    validationLogic: "manualRequired === true → manualRussian подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "manualRequired");
      if (required === null) return needs("manualRequired", "Не определено, требуется ли руководство по эксплуатации");
      if (!required) return pass("Руководство по эксплуатации не требуется");
      const manual = evidencedBoolean(context, "manualRussian");
      if (manual === null) return needs("manualRussian", "Нет подтверждения руководства на русском языке");
      if (!manual) return fail("Руководство по эксплуатации на русском языке не подтверждено");
      return pass("Руководство по эксплуатации подтверждено");
    },
  },
  {
    id: "medical.device.completeness",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Комплектность соответствует требованиям закупки",
    requiredDocument: "Документы на комплектность и принадлежности",
    validationLogic: "completenessConfirmed подтверждён",
    riskLevel: "blocker",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const complete = evidencedBoolean(context, "completenessConfirmed");
      if (complete === null) return needs("completenessConfirmed", "Нет подтверждения комплектности");
      if (!complete) return fail("Комплектность не подтверждена");
      return pass("Комплектность подтверждена");
    },
  },
  {
    id: "medical.device.conformity",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Требуется декларация или сертификат соответствия",
    requiredDocument: "Декларация или сертификат соответствия",
    validationLogic: "conformityRequired === true → conformityDocument подтверждён",
    riskLevel: "blocker",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "conformityRequired");
      if (required === null) return needs("conformityRequired", "Не определено, требуется ли документ соответствия");
      if (!required) return pass("Декларация или сертификат не требуются");
      const document = evidencedBoolean(context, "conformityDocument");
      if (document === null) return needs("conformityDocument", "Нет подтверждения декларации или сертификата");
      if (!document) return fail("Декларация или сертификат соответствия не подтверждены");
      return pass("Документ соответствия подтверждён");
    },
  },
  {
    id: "medical.device.verification",
    law: "44-ФЗ",
    article: "ст. 33",
    condition: "Средство измерений требует поверки или калибровки",
    requiredDocument: "Документы о поверке или калибровке",
    validationLogic: "verificationRequired === true → verificationDocument подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "verificationRequired");
      if (required === null) return needs("verificationRequired", "Не определено, требуется ли поверка");
      if (!required) return pass("Поверка не требуется");
      const document = evidencedBoolean(context, "verificationDocument");
      if (document === null) return needs("verificationDocument", "Нет подтверждения поверки или калибровки");
      if (!document) return fail("Документы о поверке или калибровке не подтверждены");
      return pass("Поверка или калибровка подтверждены");
    },
  },
  {
    id: "medical.device.installation",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Монтаж и ввод в эксплуатацию включены в закупку",
    requiredDocument: "Подтверждение монтажа, ввода в эксплуатацию и обучения",
    validationLogic: "installationRequired === true → installationIncluded подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "installationRequired");
      if (required === null) return needs("installationRequired", "Не определено, требуется ли монтаж");
      if (!required) return pass("Монтаж не требуется");
      const included = evidencedBoolean(context, "installationIncluded");
      if (included === null) return needs("installationIncluded", "Нет подтверждения монтажа и ввода в эксплуатацию");
      if (!included) return fail("Монтаж, ввод в эксплуатацию или обучение не включены");
      return pass("Монтаж и ввод в эксплуатацию подтверждены");
    },
  },
  {
    id: "medical.device.warranty",
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
  },
  {
    id: "medical.device.dealer_authorization",
    law: "44-ФЗ",
    article: "ст. 31",
    condition: "Требуется подтверждение дилерских полномочий",
    requiredDocument: "Дилерское письмо или договор с производителем",
    validationLogic: "dealerAuthorizationRequired === true → dealerAuthorization подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "dealerAuthorizationRequired");
      if (required === null) return needs("dealerAuthorizationRequired", "Не определено, требуются ли дилерские полномочия");
      if (!required) return pass("Дилерские полномочия не требуются");
      const document = evidencedBoolean(context, "dealerAuthorization");
      if (document === null) return needs("dealerAuthorization", "Нет подтверждения дилерских полномочий");
      if (!document) return fail("Дилерские полномочия не подтверждены");
      return pass("Дилерские полномочия подтверждены");
    },
  },
  {
    id: "medical.device.quality_management",
    law: "44-ФЗ",
    article: "ст. 31",
    condition: "Требуется сертификат системы менеджмента качества",
    requiredDocument: "Сертификат системы менеджмента качества",
    validationLogic: "qualityCertificateRequired === true → qualityCertificate подтверждён",
    riskLevel: "medium",
    effectiveFrom: "2014-01-01",
    source: LAW_44,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "qualityCertificateRequired");
      if (required === null) return needs("qualityCertificateRequired", "Не определено, требуется ли сертификат СМК");
      if (!required) return pass("Сертификат СМК не требуется");
      const document = evidencedBoolean(context, "qualityCertificate");
      if (document === null) return needs("qualityCertificate", "Нет подтверждения сертификата СМК");
      if (!document) return fail("Сертификат СМК не подтверждён");
      return pass("Сертификат СМК подтверждён");
    },
  },
  {
    id: "medical.license.maintenance",
    law: "99-ФЗ",
    article: "ст. 12",
    condition: "ТО медизделий относится к лицензируемой деятельности",
    requiredDocument: "Лицензия на техническое обслуживание медизделий",
    validationLogic: "maintenanceRequired === true → maintenanceLicense подтверждён",
    riskLevel: "high",
    effectiveFrom: "2011-11-03",
    source: `${LAW_99} · ${LAW_44}`,
    sourceUrl: LAW_99,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "maintenanceRequired");
      if (required === null) return needs("maintenanceRequired", "Не определено, требуется ли лицензия на ТО");
      if (!required) return pass("Лицензия на техническое обслуживание не требуется");
      const license = evidencedBoolean(context, "maintenanceLicense");
      if (license === null) return needs("maintenanceLicense", "Нет подтверждения лицензии на ТО медизделий");
      if (!license) return fail("Лицензия на техническое обслуживание медизделий не подтверждена");
      return pass("Лицензия на техническое обслуживание подтверждена");
    },
  },
  {
    id: "medical.license.activity",
    law: "99-ФЗ",
    article: "ст. 12",
    condition: "Медицинская деятельность лицензируется",
    requiredDocument: "Лицензия на медицинскую деятельность",
    validationLogic: "medicalActivityRequired === true → medicalActivityLicense подтверждён",
    riskLevel: "high",
    effectiveFrom: "2011-11-03",
    source: LAW_99,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "medicalActivityRequired");
      if (required === null) return needs("medicalActivityRequired", "Не определено, требуется ли лицензия на медицинскую деятельность");
      if (!required) return pass("Лицензия на медицинскую деятельность не требуется");
      const license = evidencedBoolean(context, "medicalActivityLicense");
      if (license === null) return needs("medicalActivityLicense", "Нет подтверждения лицензии на медицинскую деятельность");
      if (!license) return fail("Лицензия на медицинскую деятельность не подтверждена");
      return pass("Лицензия на медицинскую деятельность подтверждена");
    },
  },
  {
    id: "medical.security.application",
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
  },
  {
    id: "medical.security.contract",
    law: "44-ФЗ",
    article: "ст. 96",
    condition: "Обеспечение исполнения контракта предусмотрено закупкой",
    requiredDocument: "Обеспечение исполнения контракта",
    validationLogic: "contractSecurityRequired === true → сумма >= требуемой; форма/срок — если заданы",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44,
    status: "seed",
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
  },
  {
    id: "medical.delivery_schedule",
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
  },
  {
    id: "medical.margin",
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
  },
  {
    id: "medical.antidumping",
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
  },
  {
    id: "internal.no_blockers",
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
  },
  {
    id: "internal.low_risk",
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
  },
];
