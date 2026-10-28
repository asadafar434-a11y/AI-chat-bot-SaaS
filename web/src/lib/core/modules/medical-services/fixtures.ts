import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validMedicalServicesInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 800_000,
    subject: "Оказание медицинских услуг",
    submissionDeadline: "2026-11-29",
    now: "2026-10-26",
    serviceKind: "medical_services",
    requiredServiceCharacteristics: [
      { name: "Вид услуги", value: "Периодический медосмотр" },
      { name: "Срок", value: 12, unit: "месяцев", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "вид услуги", value: "периодический медосмотр" },
      { name: "Срок", value: 12, unit: "месяцев" },
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
    licenseRequired: true,
    staffRequired: true,
    sanitaryRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 8_000,
    applicationSecurityAmount: 8_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 40_000,
    contractSecurityAmount: 40_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 500_000,
    offerPrice: 650_000,
    travelCost: 10_000,
    subcontractCost: 20_000,
    otherCost: 5_000,
    serviceRequiredDate: "2027-01-15",
    serviceOfferedDate: "2027-01-10",
    maxServiceDays: 45,
    serviceDays: 30,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Медсервис» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    "medical-servicesServiceMatch": ev(true, "Таблица сопоставления", "Требования к услуге соответствуют ТЗ"),
    licenseConfirmed: ev(true, "Лицензия", "Лицензия действует"),
    staffConfirmed: ev(true, "Документы персонала", "Квалификация подтверждена"),
    sanitaryConfirmed: ev(true, "СЭЗ", "Санитарные требования подтверждены"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const medicalServicesInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validMedicalServicesInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validMedicalServicesInput.data, ...overrides },
    answers: { ...validMedicalServicesInput.answers },
    evidence,
  };
};
