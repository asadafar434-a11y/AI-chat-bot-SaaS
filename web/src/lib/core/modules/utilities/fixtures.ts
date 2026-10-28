import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validUtilitiesInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 600_000,
    subject: "Оказание коммунальных услуг",
    submissionDeadline: "2026-12-06",
    now: "2026-10-26",
    serviceKind: "utilities",
    requiredServiceCharacteristics: [
      { name: "Ресурс", value: "Водоснабжение" },
      { name: "Объём", value: 500, unit: "м³", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "ресурс", value: "водоснабжение" },
      { name: "Объём", value: 600, unit: "м³" },
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
    providerRequired: true,
    tariffRequired: true,
    slaRequired: true,
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
    offerPrice: 530_000,
    travelCost: 0,
    subcontractCost: 30_000,
    otherCost: 10_000,
    serviceRequiredDate: "2027-01-01",
    serviceOfferedDate: "2026-12-25",
    maxServiceDays: 60,
    serviceDays: 45,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Коммунальщик» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    utilitiesServiceMatch: ev(true, "Таблица сопоставления", "Требования к услуге соответствуют ТЗ"),
    providerConfirmed: ev(true, "Статус поставщика", "Статус подтверждён"),
    tariffConfirmed: ev(true, "Тарифное решение", "Тариф подтверждён"),
    slaConfirmed: ev(true, "Регламент SLA", "Качество и SLA подтверждены"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const utilitiesInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validUtilitiesInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validUtilitiesInput.data, ...overrides },
    answers: { ...validUtilitiesInput.answers },
    evidence,
  };
};
