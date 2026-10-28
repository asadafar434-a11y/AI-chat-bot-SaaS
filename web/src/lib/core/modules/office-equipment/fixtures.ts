import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validOfficeInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 500_000,
    subject: "Поставка оргтехники",
    submissionDeadline: "2026-11-15",
    now: "2026-10-26",
    productKind: "office_equipment",
    requiredCharacteristics: [
      { name: "Память", value: 16, unit: "ГБ" },
      { name: "Формат", value: "A4" },
    ],
    productCharacteristics: [
      { name: "память", value: 16, unit: "ГБ" },
      { name: "Формат", value: "a4" },
    ],
    officeCharacteristicsMatch: true,
    warrantyRequired: true,
    warrantyIncluded: true,
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
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 5_000,
    applicationSecurityAmount: 5_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 25_000,
    contractSecurityAmount: 25_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 300_000,
    offerPrice: 450_000,
    logisticsCost: 10_000,
    installationCost: 5_000,
    warrantyCost: 3_000,
    otherCost: 2_000,
    deliveryRequiredDate: "2026-12-01",
    deliveryOfferedDate: "2026-11-01",
    maxDeliveryDays: 30,
    deliveryDays: 20,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Офис» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    officeCharacteristicsMatch: ev(true, "Таблица сопоставления", "Характеристики соответствуют ТЗ"),
    warrantyIncluded: ev(true, "Коммерческое предложение", "Гарантия 12 месяцев"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const officeInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validOfficeInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validOfficeInput.data, ...overrides },
    answers: { ...validOfficeInput.answers },
    evidence,
  };
};
