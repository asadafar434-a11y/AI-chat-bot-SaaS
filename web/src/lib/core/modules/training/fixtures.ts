import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validTrainingInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 300_000,
    subject: "Оказание образовательных услуг",
    submissionDeadline: "2026-11-30",
    now: "2026-10-26",
    serviceKind: "training",
    requiredServiceCharacteristics: [
      { name: "Программа", value: "Охрана труда" },
      { name: "Объём", value: 40, unit: "часов", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "программа", value: "охрана труда" },
      { name: "Объём", value: 40, unit: "часов" },
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
    programRequired: true,
    teachersRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 3_000,
    applicationSecurityAmount: 3_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 15_000,
    contractSecurityAmount: 15_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 200_000,
    offerPrice: 270_000,
    travelCost: 0,
    subcontractCost: 10_000,
    otherCost: 5_000,
    serviceRequiredDate: "2026-12-20",
    serviceOfferedDate: "2026-12-10",
    maxServiceDays: 30,
    serviceDays: 20,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Обучение» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    trainingServiceMatch: ev(true, "Таблица сопоставления", "Требования к услуге соответствуют ТЗ"),
    licenseConfirmed: ev(true, "Лицензия", "Лицензия действует"),
    programConfirmed: ev(true, "Программа обучения", "Программа подтверждена"),
    teachersConfirmed: ev(true, "Документы преподавателей", "Квалификация подтверждена"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const trainingInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validTrainingInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validTrainingInput.data, ...overrides },
    answers: { ...validTrainingInput.answers },
    evidence,
  };
};
