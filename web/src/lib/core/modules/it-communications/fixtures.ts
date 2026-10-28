import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validItCommunicationsInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 1_500_000,
    subject: "Оказание услуг связи и ИТ",
    submissionDeadline: "2026-12-09",
    now: "2026-10-26",
    serviceKind: "it_communications",
    requiredServiceCharacteristics: [
      { name: "Услуга", value: "Интернет" },
      { name: "Скорость", value: 100, unit: "Мбит/с", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "услуга", value: "интернет" },
      { name: "Скорость", value: 200, unit: "Мбит/с" },
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
    slaRequired: true,
    securityRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 15_000,
    applicationSecurityAmount: 15_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 75_000,
    contractSecurityAmount: 75_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 1_000_000,
    offerPrice: 1_300_000,
    travelCost: 0,
    subcontractCost: 100_000,
    otherCost: 20_000,
    serviceRequiredDate: "2027-01-01",
    serviceOfferedDate: "2026-12-25",
    maxServiceDays: 60,
    serviceDays: 45,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «ИТ-Связь» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    "it-communicationsServiceMatch": ev(true, "Таблица сопоставления", "Требования к услуге соответствуют ТЗ"),
    licenseConfirmed: ev(true, "Лицензия оператора связи", "Лицензия действует"),
    slaConfirmed: ev(true, "Регламент SLA", "SLA подтверждён"),
    securityConfirmed: ev(true, "Подтверждение защиты информации", "Защита подтверждена"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const itCommunicationsInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validItCommunicationsInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validItCommunicationsInput.data, ...overrides },
    answers: { ...validItCommunicationsInput.answers },
    evidence,
  };
};
