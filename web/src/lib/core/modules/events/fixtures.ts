import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validEventsInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 700_000,
    subject: "Организация и проведение мероприятия",
    submissionDeadline: "2026-12-01",
    now: "2026-10-26",
    serviceKind: "events",
    requiredServiceCharacteristics: [
      { name: "Тип мероприятия", value: "Конференция" },
      { name: "Количество участников", value: 100, unit: "чел.", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "тип мероприятия", value: "конференция" },
      { name: "Количество участников", value: 120, unit: "чел." },
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
    venueRequired: true,
    safetyRequired: true,
    staffRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 7_000,
    applicationSecurityAmount: 7_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 35_000,
    contractSecurityAmount: 35_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 450_000,
    offerPrice: 600_000,
    travelCost: 20_000,
    subcontractCost: 50_000,
    otherCost: 10_000,
    serviceRequiredDate: "2027-02-01",
    serviceOfferedDate: "2027-01-20",
    maxServiceDays: 60,
    serviceDays: 45,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Мероприятия» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    eventsServiceMatch: ev(true, "Таблица сопоставления", "Требования к услуге соответствуют ТЗ"),
    venueConfirmed: ev(true, "Договор площадки", "Площадка подтверждена"),
    safetyConfirmed: ev(true, "План безопасности", "План подтверждён"),
    staffConfirmed: ev(true, "Подтверждение персонала", "Персонал и оборудование подтверждены"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const eventsInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validEventsInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validEventsInput.data, ...overrides },
    answers: { ...validEventsInput.answers },
    evidence,
  };
};
