import type { EvidenceValue, FlowContext, Rule, RuleEvaluation } from "../../flow/types.ts";
import { matchCharacteristics } from "./characteristics.ts";
import { checkMedicineRegistrationRecord } from "./medicine-registration.ts";

const LAW_44_ART_43 = "https://www.consultant.ru/document/cons_doc_LAW_144624/5a18b3d46fe0fd48f2482cd6ec7ce419763efccd/";
const LAW_61 = "https://www.consultant.ru/document/cons_doc_LAW_99350/";
const LAW_99 = "https://www.consultant.ru/document/cons_doc_LAW_113658/";

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

const evidencedNumber = (context: FlowContext, key: string): number | null => {
  const item = evidenceOf(context, key);
  if (!item) return null;
  if (typeof item.value === "number" && Number.isFinite(item.value)) return item.value;
  if (typeof item.value !== "string" || item.value.trim().length === 0) return null;
  const parsed = Number(item.value);
  return Number.isFinite(parsed) ? parsed : null;
};

const pass = (detail: string): RuleEvaluation => ({ passed: true, detail, missing: [] });
const fail = (detail: string): RuleEvaluation => ({ passed: false, detail, missing: [] });
const needs = (fieldName: string, detail: string): RuleEvaluation => ({ passed: false, detail, missing: [fieldName] });

export const medicineRules: Rule[] = [
  {
    id: "medicine.registration.required",
    law: "61-ФЗ",
    article: "ст. 13",
    condition: "Лекарственный препарат зарегистрирован",
    requiredDocument: "Регистрационное удостоверение лекарственного препарата",
    validationLogic: "medicineRegistrationRecord.active; иначе medicineRegistration подтверждён",
    riskLevel: "blocker",
    effectiveFrom: "2010-04-12",
    source: LAW_61,
    status: "seed",
    evaluate: (context) => {
      const record = field(context, "medicineRegistrationRecord");
      if (record !== undefined && record !== null) {
        const result = checkMedicineRegistrationRecord(record, {
          registrationNumber: textField(context, "medicineRegistration") ?? undefined,
        });
        if (result.missing.length > 0) return needs(result.missing[0], result.detail);
        if (!result.matched) return fail(result.detail);
        return pass(result.detail);
      }
      const registration = evidencedText(context, "medicineRegistration");
      if (!registration) return needs("medicineRegistration", "Не подтверждено РУ лекарственного препарата");
      return pass(`РУ лекарственного препарата: ${registration}`);
    },
  },
  {
    id: "medicine.registration.matches",
    law: "61-ФЗ",
    article: "ст. 13",
    condition: "РУ покрывает препарат, форму, дозировку и производителя",
    requiredDocument: "РУ с приложением",
    validationLogic: "medicineRegistrationRecord сверяется с препаратом; иначе medicineRegistrationMatches",
    riskLevel: "blocker",
    effectiveFrom: "2010-04-12",
    source: LAW_61,
    status: "seed",
    evaluate: (context) => {
      const record = field(context, "medicineRegistrationRecord");
      if (record !== undefined && record !== null) {
        const expected = {
          registrationNumber: textField(context, "medicineRegistration") ?? undefined,
          name: textField(context, "medicineName") ?? undefined,
          form: textField(context, "medicineForm") ?? undefined,
          dosage: textField(context, "medicineDosage") ?? undefined,
          manufacturer: textField(context, "medicineManufacturer") ?? undefined,
        };
        if (Object.values(expected).some((value) => value !== undefined)) {
          const result = checkMedicineRegistrationRecord(record, expected);
          if (result.missing.length > 0) return needs(result.missing[0], result.detail);
          if (!result.matched) return fail(result.detail);
          return pass(result.detail);
        }
      }
      const matches = evidencedBoolean(context, "medicineRegistrationMatches");
      if (matches === null) return needs("medicineRegistrationMatches", "Нет подтверждения соответствия РУ препарату");
      if (!matches) return fail("РУ не покрывает предложенный препарат, форму, дозировку или производителя");
      return pass("РУ покрывает предложенный препарат");
    },
  },
  {
    id: "medicine.characteristics",
    law: "44-ФЗ",
    article: "ст. 33, 43",
    condition: "Характеристики лекарственного препарата соответствуют ТЗ",
    requiredDocument: "Таблица характеристик по ТЗ",
    validationLogic: "построчное сопоставление; иначе medicineCharacteristicsMatch",
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
          return needs(result.missing[0], "Нужны требования ТЗ и характеристики препарата для построчной сверки");
        }
        if (!result.matched) {
          const names = result.mismatches.map((item) => item.name).join(", ");
          return fail(`Расхождения по характеристикам: ${names}`);
        }
        return pass("Характеристики препарата сопоставлены построчно");
      }
      const match = evidencedBoolean(context, "medicineCharacteristicsMatch");
      if (match === null) return needs("medicineCharacteristicsMatch", "Нет подтверждённого сопоставления характеристик");
      if (!match) return fail("Характеристики препарата не соответствуют ТЗ");
      return pass("Характеристики препарата соответствуют ТЗ");
    },
  },
  {
    id: "medicine.zhvnlp",
    law: "61-ФЗ",
    article: "ст. 61",
    condition: "Препарат входит в ЖНВЛП; цена не выше предельной",
    requiredDocument: "Подтверждение предельной отпускной цены ЖНВЛП",
    validationLogic: "zhvnlpApplies === true → zhvnlpMaxPrice подтверждена и offerPrice <= zhvnlpMaxPrice",
    riskLevel: "high",
    effectiveFrom: "2010-04-12",
    source: LAW_61,
    status: "seed",
    evaluate: (context) => {
      const applies = booleanField(context, "zhvnlpApplies");
      if (applies === null) return needs("zhvnlpApplies", "Не определено, входит ли препарат в ЖНВЛП");
      if (!applies) return pass("Препарат не входит в ЖНВЛП");
      const limit = evidencedNumber(context, "zhvnlpMaxPrice");
      if (limit === null) return needs("zhvnlpMaxPrice", "Нет подтверждённой предельной цены ЖНВЛП");
      const offerPrice = numberField(context, "offerPrice");
      if (offerPrice === null) return needs("offerPrice", "Не указана цена предложения");
      if (offerPrice > limit) return fail(`Цена ${offerPrice} выше предельной ${limit}`);
      return pass(`Цена ${offerPrice} не выше предельной ${limit}`);
    },
  },
  {
    id: "medicine.vat_rate",
    law: "НК РФ",
    article: "ст. 164",
    condition: "Ставка НДС соответствует требованиям закупки",
    requiredDocument: "Подтверждение применимой ставки НДС",
    validationLogic: "vatRateExpected подтверждена → vatRate совпадает",
    riskLevel: "high",
    effectiveFrom: "2001-01-01",
    source: "https://www.consultant.ru/document/cons_doc_LAW_28165/",
    status: "seed",
    evaluate: (context) => {
      const expected = evidencedNumber(context, "vatRateExpected");
      if (expected === null) return needs("vatRateExpected", "Нет подтверждённой применимой ставки НДС");
      const actual = numberField(context, "vatRate");
      if (actual === null) return needs("vatRate", "Не указана ставка НДС в предложении");
      if (actual !== expected) return fail(`Ставка НДС ${actual} не совпадает с ожидаемой ${expected}`);
      return pass(`Ставка НДС ${actual} совпадает с ожидаемой`);
    },
  },
  {
    id: "medicine.price_registration",
    law: "61-ФЗ",
    article: "ст. 61",
    condition: "Для препарата требуется зарегистрированная предельная цена",
    requiredDocument: "Подтверждение регистрации предельной цены",
    validationLogic: "priceRegistrationRequired === true → priceRegistrationConfirmed подтверждён",
    riskLevel: "high",
    effectiveFrom: "2010-04-12",
    source: LAW_61,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "priceRegistrationRequired");
      if (required === null) return needs("priceRegistrationRequired", "Не определено, требуется ли регистрация цены");
      if (!required) return pass("Регистрация предельной цены не требуется");
      const confirmed = evidencedBoolean(context, "priceRegistrationConfirmed");
      if (confirmed === null) return needs("priceRegistrationConfirmed", "Нет подтверждения регистрации предельной цены");
      if (!confirmed) return fail("Предельная цена не зарегистрирована");
      return pass("Предельная цена зарегистрирована");
    },
  },
  {
    id: "medicine.markup",
    law: "61-ФЗ",
    article: "ст. 63",
    condition: "Оптовая надбавка не выше установленной",
    requiredDocument: "Подтверждение предельной оптовой надбавки",
    validationLogic: "markupLimitApplies === true → wholesaleMarkupPercent <= maxWholesaleMarkupPercent",
    riskLevel: "high",
    effectiveFrom: "2010-04-12",
    source: LAW_61,
    status: "seed",
    evaluate: (context) => {
      const applies = booleanField(context, "markupLimitApplies");
      if (applies === null) return needs("markupLimitApplies", "Не определено, применяется ли предельная надбавка");
      if (!applies) return pass("Предельная оптовая надбавка не применяется");
      const limit = evidencedNumber(context, "maxWholesaleMarkupPercent");
      if (limit === null) return needs("maxWholesaleMarkupPercent", "Нет подтверждённой предельной надбавки");
      const actual = numberField(context, "wholesaleMarkupPercent");
      if (actual === null) return needs("wholesaleMarkupPercent", "Не указана фактическая оптовая надбавка");
      if (actual > limit) return fail(`Надбавка ${actual}% выше предельной ${limit}%`);
      return pass(`Надбавка ${actual}% не выше предельной ${limit}%`);
    },
  },
  {
    id: "medicine.shelf_life",
    law: "44-ФЗ",
    article: "ст. 33",
    condition: "Остаточный срок годности не меньше требуемого",
    requiredDocument: "Подтверждение остаточного срока годности",
    validationLogic: "shelfLifeRequired === true → shelfLifeMonths >= requiredShelfLifeMonths",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "shelfLifeRequired");
      if (required === null) return needs("shelfLifeRequired", "Не определено, установлен ли срок годности");
      if (!required) return pass("Требование к остаточному сроку годности не установлено");
      const minimum = numberField(context, "requiredShelfLifeMonths");
      if (minimum === null) return needs("requiredShelfLifeMonths", "Не указан требуемый остаточный срок годности");
      const remaining = numberField(context, "shelfLifeMonths");
      if (remaining === null) return needs("shelfLifeMonths", "Не указан остаточный срок годности препарата");
      if (remaining < minimum) return fail(`Остаточный срок ${remaining} мес. меньше требуемого ${minimum} мес.`);
      return pass(`Остаточный срок ${remaining} мес. не меньше требуемого ${minimum} мес.`);
    },
  },
  {
    id: "medicine.cold_chain",
    law: "44-ФЗ",
    article: "ст. 33",
    condition: "Требуется соблюдение холодовой цепи",
    requiredDocument: "Подтверждение условий хранения и перевозки",
    validationLogic: "coldChainRequired === true → coldChainConfirmed подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "coldChainRequired");
      if (required === null) return needs("coldChainRequired", "Не определено, требуется ли холодовая цепь");
      if (!required) return pass("Холодовая цепь не требуется");
      const confirmed = evidencedBoolean(context, "coldChainConfirmed");
      if (confirmed === null) return needs("coldChainConfirmed", "Нет подтверждения холодовой цепи");
      if (!confirmed) return fail("Холодовая цепь не подтверждена");
      return pass("Холодовая цепь подтверждена");
    },
  },
  {
    id: "medicine.marking",
    law: "44-ФЗ",
    article: "ст. 33",
    condition: "Требуется маркировка средствами идентификации",
    requiredDocument: "Подтверждение маркировки",
    validationLogic: "markingRequired === true → markingConfirmed подтверждён",
    riskLevel: "high",
    effectiveFrom: "2014-01-01",
    source: LAW_44_ART_43,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "markingRequired");
      if (required === null) return needs("markingRequired", "Не определено, требуется ли маркировка");
      if (!required) return pass("Маркировка не требуется");
      const confirmed = evidencedBoolean(context, "markingConfirmed");
      if (confirmed === null) return needs("markingConfirmed", "Нет подтверждения маркировки");
      if (!confirmed) return fail("Маркировка средствами идентификации не подтверждена");
      return pass("Маркировка подтверждена");
    },
  },
  {
    id: "medicine.license",
    law: "99-ФЗ",
    article: "ст. 12",
    condition: "Требуется лицензия на фармацевтическую деятельность",
    requiredDocument: "Лицензия на фармацевтическую деятельность",
    validationLogic: "pharmacyLicenseRequired === true → pharmacyLicense подтверждён",
    riskLevel: "high",
    effectiveFrom: "2011-11-03",
    source: LAW_99,
    status: "seed",
    evaluate: (context) => {
      const required = booleanField(context, "pharmacyLicenseRequired");
      if (required === null) return needs("pharmacyLicenseRequired", "Не определено, требуется ли лицензия");
      if (!required) return pass("Лицензия на фармацевтическую деятельность не требуется");
      const license = evidencedBoolean(context, "pharmacyLicense");
      if (license === null) return needs("pharmacyLicense", "Нет подтверждения лицензии на фармацевтическую деятельность");
      if (!license) return fail("Лицензия на фармацевтическую деятельность не подтверждена");
      return pass("Лицензия на фармацевтическую деятельность подтверждена");
    },
  },
];
