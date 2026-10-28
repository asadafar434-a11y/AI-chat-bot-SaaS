import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validEducationalEquipmentInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 900_000,
    subject: "Поставка учебного оборудования",
    submissionDeadline: "2026-11-26",
    now: "2026-10-26",
    productKind: "educational_equipment",
    requiredCharacteristics: [
      { name: "Тип", value: "Интерактивная панель" },
      { name: "Диагональ", value: 65, unit: "дюйм", op: "gte" },
    ],
    productCharacteristics: [
      { name: "тип", value: "интерактивная панель" },
      { name: "Диагональ", value: 75, unit: "дюйм" },
    ],
    educationalEquipmentCharacteristicsMatch: true,
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
    conformityRequired: true,
    sanitaryRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 9_000,
    applicationSecurityAmount: 9_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 45_000,
    contractSecurityAmount: 45_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 600_000,
    offerPrice: 780_000,
    logisticsCost: 20_000,
    installationCost: 10_000,
    warrantyCost: 5_000,
    otherCost: 5_000,
    deliveryRequiredDate: "2026-12-18",
    deliveryOfferedDate: "2026-12-01",
    maxDeliveryDays: 45,
    deliveryDays: 35,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Учебное оборудование» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    educationalEquipmentCharacteristicsMatch: ev(true, "Таблица сопоставления", "Характеристики соответствуют ТЗ"),
    warrantyIncluded: ev(true, "Коммерческое предложение", "Гарантия 24 месяца"),
    conformityDocument: ev(true, "Сертификат соответствия", "Сертификат подтверждён"),
    sanitaryConclusion: ev(true, "СЭЗ", "Заключение подтверждено"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const educationalEquipmentInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validEducationalEquipmentInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validEducationalEquipmentInput.data, ...overrides },
    answers: { ...validEducationalEquipmentInput.answers },
    evidence,
  };
};
