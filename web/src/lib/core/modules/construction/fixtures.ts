import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validConstructionInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 5_000_000,
    subject: "Выполнение строительных работ",
    submissionDeadline: "2026-12-03",
    now: "2026-10-26",
    serviceKind: "construction",
    requiredServiceCharacteristics: [
      { name: "Вид работ", value: "Капитальный ремонт" },
      { name: "Площадь", value: 1_000, unit: "м²", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "вид работ", value: "капитальный ремонт" },
      { name: "Площадь", value: 1_200, unit: "м²" },
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
    sroRequired: true,
    permitsRequired: true,
    safetyRequired: true,
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
    travelCost: 50_000,
    subcontractCost: 300_000,
    otherCost: 50_000,
    serviceRequiredDate: "2027-03-01",
    serviceOfferedDate: "2027-02-15",
    maxServiceDays: 120,
    serviceDays: 90,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Строй» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    constructionServiceMatch: ev(true, "Таблица сопоставления", "Требования к работам соответствуют ТЗ"),
    sroConfirmed: ev(true, "Свидетельство СРО", "Членство подтверждено"),
    permitsConfirmed: ev(true, "Разрешения", "Разрешения и согласования подтверждены"),
    safetyConfirmed: ev(true, "План безопасности", "План подтверждён"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const constructionInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validConstructionInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validConstructionInput.data, ...overrides },
    answers: { ...validConstructionInput.answers },
    evidence,
  };
};
