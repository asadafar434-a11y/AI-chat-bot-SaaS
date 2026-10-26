import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validFurnitureInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 800_000,
    subject: "Поставка мебели",
    submissionDeadline: "2026-11-20",
    now: "2026-10-26",
    productKind: "furniture",
    requiredCharacteristics: [
      { name: "Материал", value: "ЛДСП" },
      { name: "Ширина", value: 120, unit: "см", op: "gte" },
    ],
    productCharacteristics: [
      { name: "материал", value: "лдсп" },
      { name: "Ширина", value: 140, unit: "см" },
    ],
    furnitureCharacteristicsMatch: true,
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
    cost: 550_000,
    offerPrice: 700_000,
    logisticsCost: 15_000,
    installationCost: 10_000,
    warrantyCost: 5_000,
    otherCost: 5_000,
    deliveryRequiredDate: "2026-12-10",
    deliveryOfferedDate: "2026-11-20",
    maxDeliveryDays: 45,
    deliveryDays: 30,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Мебель» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    furnitureCharacteristicsMatch: ev(true, "Таблица сопоставления", "Характеристики соответствуют ТЗ"),
    warrantyIncluded: ev(true, "Коммерческое предложение", "Гарантия 18 месяцев"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const furnitureInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validFurnitureInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validFurnitureInput.data, ...overrides },
    answers: { ...validFurnitureInput.answers },
    evidence,
  };
};
