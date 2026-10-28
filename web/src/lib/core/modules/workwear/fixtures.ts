import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validWorkwearInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 400_000,
    subject: "Поставка спецодежды и СИЗ",
    submissionDeadline: "2026-11-22",
    now: "2026-10-26",
    productKind: "workwear",
    requiredCharacteristics: [
      { name: "Материал", value: "Хлопок" },
      { name: "Класс защиты", value: "2" },
    ],
    productCharacteristics: [
      { name: "материал", value: "хлопок" },
      { name: "Класс защиты", value: "2" },
    ],
    workwearCharacteristicsMatch: true,
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
    sizeRangeRequired: true,
    labelingRequired: true,
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
    offerPrice: 350_000,
    logisticsCost: 10_000,
    installationCost: 0,
    warrantyCost: 0,
    otherCost: 5_000,
    deliveryRequiredDate: "2026-12-15",
    deliveryOfferedDate: "2026-11-25",
    maxDeliveryDays: 40,
    deliveryDays: 25,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «СИЗ» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    workwearCharacteristicsMatch: ev(true, "Таблица сопоставления", "Характеристики соответствуют ТЗ"),
    conformityDocument: ev(true, "Сертификат соответствия", "ТР ТС 019/2011"),
    sizeRangeCovered: ev(true, "Таблица размеров", "Размерный ряд покрывает потребность"),
    labelingConfirmed: ev(true, "Подтверждение маркировки", "Маркировка и упаковка соответствуют"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const workwearInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validWorkwearInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validWorkwearInput.data, ...overrides },
    answers: { ...validWorkwearInput.answers },
    evidence,
  };
};
