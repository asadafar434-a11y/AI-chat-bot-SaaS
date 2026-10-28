import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validStationeryInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 200_000,
    subject: "Поставка канцтоваров",
    submissionDeadline: "2026-11-18",
    now: "2026-10-26",
    productKind: "stationery",
    requiredCharacteristics: [
      { name: "Плотность", value: 80, unit: "г/м²", op: "gte" },
      { name: "Формат", value: "A4" },
    ],
    productCharacteristics: [
      { name: "плотность", value: 90, unit: "г/м²" },
      { name: "Формат", value: "a4" },
    ],
    stationeryCharacteristicsMatch: true,
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
    applicationSecurityRequiredAmount: 2_000,
    applicationSecurityAmount: 2_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 10_000,
    contractSecurityAmount: 10_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 120_000,
    offerPrice: 180_000,
    logisticsCost: 5_000,
    installationCost: 0,
    warrantyCost: 2_000,
    otherCost: 3_000,
    deliveryRequiredDate: "2026-12-10",
    deliveryOfferedDate: "2026-11-20",
    maxDeliveryDays: 30,
    deliveryDays: 20,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Канцтовары» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    stationeryCharacteristicsMatch: ev(true, "Таблица сопоставления", "Характеристики соответствуют ТЗ"),
    warrantyIncluded: ev(true, "Коммерческое предложение", "Гарантия 12 месяцев"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const stationeryInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validStationeryInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validStationeryInput.data, ...overrides },
    answers: { ...validStationeryInput.answers },
    evidence,
  };
};
