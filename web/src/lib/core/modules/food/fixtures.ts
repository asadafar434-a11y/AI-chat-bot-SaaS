import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validFoodInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 400_000,
    subject: "Поставка продуктов питания",
    submissionDeadline: "2026-12-14",
    now: "2026-10-26",
    productKind: "food",
    requiredCharacteristics: [
      { name: "Наименование", value: "Молоко" },
      { name: "Жирность", value: 3.2, unit: "%", op: "gte" },
    ],
    productCharacteristics: [
      { name: "наименование", value: "молоко" },
      { name: "Жирность", value: 3.5, unit: "%" },
    ],
    foodCharacteristicsMatch: true,
    warrantyRequired: false,
    warrantyIncluded: false,
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
    conformityRequired: true,
    shelfLifeRequiredDays: 10,
    offeredShelfLifeDays: 14,
    storageRequired: true,
    veterinaryRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 4_000,
    applicationSecurityAmount: 4_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 20_000,
    contractSecurityAmount: 20_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 250_000,
    offerPrice: 320_000,
    logisticsCost: 10_000,
    installationCost: 0,
    warrantyCost: 0,
    otherCost: 5_000,
    deliveryRequiredDate: "2026-12-25",
    deliveryOfferedDate: "2026-12-15",
    maxDeliveryDays: 30,
    deliveryDays: 20,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Продукты» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    foodCharacteristicsMatch: ev(true, "Таблица сопоставления", "Характеристики соответствуют ТЗ"),
    conformityDocument: ev(true, "Декларация соответствия", "Декларация подтверждена"),
    storageConfirmed: ev(true, "Условия хранения", "Условия подтверждены"),
    veterinaryConfirmed: ev(true, "Ветеринарный сертификат", "Сертификат подтверждён"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const foodInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validFoodInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validFoodInput.data, ...overrides },
    answers: { ...validFoodInput.answers },
    evidence,
  };
};
