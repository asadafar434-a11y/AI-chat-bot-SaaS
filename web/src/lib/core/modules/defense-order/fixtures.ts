import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validDefenseOrderInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 5_000_000,
    subject: "Поставка продукции по ГОЗ",
    submissionDeadline: "2026-12-13",
    now: "2026-10-26",
    serviceKind: "defense_order",
    requiredServiceCharacteristics: [
      { name: "Продукция", value: "Комплектующие" },
      { name: "Количество", value: 100, unit: "шт.", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "продукция", value: "комплектующие" },
      { name: "Количество", value: 100, unit: "шт." },
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
    secrecyRequired: true,
    separateAccountingRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 50_000,
    applicationSecurityAmount: 50_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 250_000,
    contractSecurityAmount: 250_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 3_500_000,
    offerPrice: 4_500_000,
    travelCost: 0,
    subcontractCost: 200_000,
    otherCost: 50_000,
    serviceRequiredDate: "2027-06-01",
    serviceOfferedDate: "2027-05-15",
    maxServiceDays: 180,
    serviceDays: 150,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "АО «ГОЗ» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    defenseOrderServiceMatch: ev(true, "Таблица сопоставления", "Требования к продукции соответствуют ТЗ"),
    licenseConfirmed: ev(true, "Лицензия на ГОЗ", "Лицензия действует"),
    secrecyConfirmed: ev(true, "Допуск", "Допуск подтверждён"),
    separateAccountingConfirmed: ev(true, "Раздельный учёт", "Учёт и приёмка подтверждены"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const defenseOrderInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validDefenseOrderInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validDefenseOrderInput.data, ...overrides },
    answers: { ...validDefenseOrderInput.answers },
    evidence,
  };
};
