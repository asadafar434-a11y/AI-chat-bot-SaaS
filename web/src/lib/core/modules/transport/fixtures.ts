import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validTransportInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 900_000,
    subject: "Оказание транспортных услуг",
    submissionDeadline: "2026-12-05",
    now: "2026-10-26",
    serviceKind: "transport",
    requiredServiceCharacteristics: [
      { name: "Тип транспорта", value: "Автобус" },
      { name: "Количество", value: 5, unit: "ед.", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "тип транспорта", value: "автобус" },
      { name: "Количество", value: 5, unit: "ед." },
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
    fleetRequired: true,
    insuranceRequired: true,
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
    offerPrice: 800_000,
    travelCost: 20_000,
    subcontractCost: 60_000,
    otherCost: 20_000,
    serviceRequiredDate: "2027-01-15",
    serviceOfferedDate: "2027-01-10",
    maxServiceDays: 60,
    serviceDays: 45,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Транспорт» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    transportServiceMatch: ev(true, "Таблица сопоставления", "Требования к услуге соответствуют ТЗ"),
    licenseConfirmed: ev(true, "Лицензия", "Лицензия действует"),
    fleetConfirmed: ev(true, "Документы на транспорт", "Транспорт подтверждён"),
    insuranceConfirmed: ev(true, "Полис страхования", "Страхование подтверждено"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const transportInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validTransportInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validTransportInput.data, ...overrides },
    answers: { ...validTransportInput.answers },
    evidence,
  };
};
