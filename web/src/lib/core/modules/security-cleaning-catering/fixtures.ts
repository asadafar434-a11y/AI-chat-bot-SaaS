import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validSecurityCleaningCateringInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 1_000_000,
    subject: "Охрана, уборка и питание",
    submissionDeadline: "2026-12-11",
    now: "2026-10-26",
    serviceKind: "security_cleaning_catering",
    requiredServiceCharacteristics: [
      { name: "Услуга", value: "Комплексное обслуживание" },
      { name: "Количество сотрудников", value: 10, unit: "чел.", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "услуга", value: "комплексное обслуживание" },
      { name: "Количество сотрудников", value: 12, unit: "чел." },
    ],
    participantRegistration: true,
    signatoryAuthority: true,
    restrictionsClear: true,
    bankDetails: true,
    majorTransactionRequired: false,
    majorTransactionApproved: false,
    experienceRequired: false,
    experienceConfirmed: false,
    smpStatusRequired: false,
    smpStatusConfirmed: false,
    securityLicenseRequired: true,
    staffRequired: true,
    foodSafetyRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 10_000,
    applicationSecurityAmount: 10_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 50_000,
    contractSecurityAmount: 50_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 700_000,
    offerPrice: 900_000,
    travelCost: 0,
    subcontractCost: 50_000,
    otherCost: 10_000,
    serviceRequiredDate: "2027-01-01",
    serviceOfferedDate: "2026-12-20",
    maxServiceDays: 60,
    serviceDays: 45,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Сервис» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    "security-cleaning-cateringServiceMatch": ev(true, "Таблица сопоставления", "Требования к услуге соответствуют ТЗ"),
    securityLicenseConfirmed: ev(true, "Лицензия на охрану", "Лицензия действует"),
    staffConfirmed: ev(true, "Документы персонала", "Персонал подтверждён"),
    foodSafetyConfirmed: ev(true, "Подтверждение питания", "Безопасность питания подтверждена"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const securityCleaningCateringInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validSecurityCleaningCateringInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validSecurityCleaningCateringInput.data, ...overrides },
    answers: { ...validSecurityCleaningCateringInput.answers },
    evidence,
  };
};
