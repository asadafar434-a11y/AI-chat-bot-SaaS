import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validBuildingMaterialsInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 600_000,
    subject: "Поставка стройматериалов",
    submissionDeadline: "2026-11-24",
    now: "2026-10-26",
    productKind: "building_materials",
    requiredCharacteristics: [
      { name: "Марка бетона", value: "M300" },
      { name: "Прочность", value: 30, unit: "МПа", op: "gte" },
    ],
    productCharacteristics: [
      { name: "марка бетона", value: "m300" },
      { name: "Прочность", value: 35, unit: "МПа" },
    ],
    buildingMaterialsCharacteristicsMatch: true,
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
    batchPassportRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 6_000,
    applicationSecurityAmount: 6_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 30_000,
    contractSecurityAmount: 30_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 400_000,
    offerPrice: 520_000,
    logisticsCost: 15_000,
    installationCost: 0,
    warrantyCost: 0,
    otherCost: 5_000,
    deliveryRequiredDate: "2026-12-15",
    deliveryOfferedDate: "2026-11-30",
    maxDeliveryDays: 40,
    deliveryDays: 30,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Стройматериалы» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    buildingMaterialsCharacteristicsMatch: ev(true, "Таблица сопоставления", "Характеристики соответствуют ТЗ"),
    conformityDocument: ev(true, "Сертификат соответствия", "Сертификат подтверждён"),
    batchPassport: ev(true, "Паспорт партии", "Паспорт качества подтверждён"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const buildingMaterialsInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validBuildingMaterialsInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validBuildingMaterialsInput.data, ...overrides },
    answers: { ...validBuildingMaterialsInput.answers },
    evidence,
  };
};
