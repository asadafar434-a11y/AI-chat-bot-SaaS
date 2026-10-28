import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validAutomobileInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 2_000_000,
    subject: "Поставка автомобилей",
    submissionDeadline: "2026-11-25",
    now: "2026-10-26",
    productKind: "automobile",
    requiredCharacteristics: [
      { name: "Тип двигателя", value: "Бензин" },
      { name: "Мощность", value: 150, unit: "л.с.", op: "gte" },
    ],
    productCharacteristics: [
      { name: "тип двигателя", value: "бензин" },
      { name: "Мощность", value: 160, unit: "л.с." },
    ],
    automobileCharacteristicsMatch: true,
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
    vinRequired: true,
    minYear: 2022,
    vehicleYear: 2023,
    maxMileage: 50_000,
    vehicleMileage: 30_000,
    legalStatusRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 20_000,
    applicationSecurityAmount: 20_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 100_000,
    contractSecurityAmount: 100_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 1_500_000,
    offerPrice: 1_800_000,
    logisticsCost: 50_000,
    installationCost: 0,
    warrantyCost: 20_000,
    otherCost: 30_000,
    deliveryRequiredDate: "2026-12-20",
    deliveryOfferedDate: "2026-12-01",
    maxDeliveryDays: 60,
    deliveryDays: 45,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Авто» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    automobileCharacteristicsMatch: ev(true, "Таблица сопоставления", "Характеристики соответствуют ТЗ"),
    warrantyIncluded: ev(true, "Коммерческое предложение", "Гарантия 36 месяцев"),
    vinConfirmed: ev(true, "ПТС и VIN", "VIN подтверждён"),
    legalStatusConfirmed: ev(true, "Выписка из реестра", "Залог и ограничения отсутствуют"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const automobileInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validAutomobileInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validAutomobileInput.data, ...overrides },
    answers: { ...validAutomobileInput.answers },
    evidence,
  };
};
