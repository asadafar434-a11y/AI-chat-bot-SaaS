import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validToroInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 800_000,
    subject: "Техническое обслуживание и ремонт оборудования",
    submissionDeadline: "2026-12-12",
    now: "2026-10-26",
    serviceKind: "toro",
    requiredServiceCharacteristics: [
      { name: "Оборудование", value: "Серверы" },
      { name: "Срок реакции", value: 4, unit: "часа", op: "lte" },
    ],
    offeredServiceCharacteristics: [
      { name: "оборудование", value: "серверы" },
      { name: "Срок реакции", value: 3, unit: "часа" },
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
    authorizationRequired: true,
    sparePartsRequired: true,
    slaRequired: true,
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
    cost: 500_000,
    offerPrice: 700_000,
    travelCost: 10_000,
    subcontractCost: 40_000,
    otherCost: 10_000,
    serviceRequiredDate: "2027-01-01",
    serviceOfferedDate: "2026-12-20",
    maxServiceDays: 60,
    serviceDays: 45,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «ТОРО» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    toroServiceMatch: ev(true, "Таблица сопоставления", "Требования к услуге соответствуют ТЗ"),
    authorizationConfirmed: ev(true, "Авторизация производителя", "Авторизация подтверждена"),
    sparePartsConfirmed: ev(true, "Наличие запчастей", "Запасные части подтверждены"),
    slaConfirmed: ev(true, "Регламент SLA", "SLA подтверждён"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const toroInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validToroInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validToroInput.data, ...overrides },
    answers: { ...validToroInput.answers },
    evidence,
  };
};
