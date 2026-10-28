import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validScienceResearchInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 3_000_000,
    subject: "Выполнение научно-исследовательских работ",
    submissionDeadline: "2026-12-10",
    now: "2026-10-26",
    serviceKind: "science_research",
    requiredServiceCharacteristics: [
      { name: "Тема", value: "Новый материал" },
      { name: "Этапы", value: 3, unit: "этапов", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "тема", value: "новый материал" },
      { name: "Этапы", value: 3, unit: "этапов" },
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
    qualificationRequired: true,
    methodologyRequired: true,
    ipRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 30_000,
    applicationSecurityAmount: 30_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 150_000,
    contractSecurityAmount: 150_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 2_000_000,
    offerPrice: 2_600_000,
    travelCost: 50_000,
    subcontractCost: 200_000,
    otherCost: 50_000,
    serviceRequiredDate: "2027-12-01",
    serviceOfferedDate: "2027-11-15",
    maxServiceDays: 365,
    serviceDays: 300,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «НИОКР» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    "science-researchServiceMatch": ev(true, "Таблица сопоставления", "Требования к работам соответствуют ТЗ"),
    qualificationConfirmed: ev(true, "Документы о квалификации", "Квалификация подтверждена"),
    methodologyConfirmed: ev(true, "Методика и программа", "Методика подтверждена"),
    ipConfirmed: ev(true, "Соглашение о правах", "Права урегулированы"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const scienceResearchInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validScienceResearchInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validScienceResearchInput.data, ...overrides },
    answers: { ...validScienceResearchInput.answers },
    evidence,
  };
};
