import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validDesignSurveysInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 2_000_000,
    subject: "Проектирование и изыскания",
    submissionDeadline: "2026-12-07",
    now: "2026-10-26",
    serviceKind: "design_surveys",
    requiredServiceCharacteristics: [
      { name: "Вид работ", value: "Проектная документация" },
      { name: "Площадь", value: 5_000, unit: "м²", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "вид работ", value: "проектная документация" },
      { name: "Площадь", value: 5_500, unit: "м²" },
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
    projectExperienceRequired: true,
    approvalsRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 20_000,
    applicationSecurityAmount: 20_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 100_000,
    contractSecurityAmount: 100_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 1_300_000,
    offerPrice: 1_700_000,
    travelCost: 30_000,
    subcontractCost: 100_000,
    otherCost: 20_000,
    serviceRequiredDate: "2027-06-01",
    serviceOfferedDate: "2027-05-15",
    maxServiceDays: 180,
    serviceDays: 150,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Проект» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    "design-surveysServiceMatch": ev(true, "Таблица сопоставления", "Требования к работам соответствуют ТЗ"),
    sroConfirmed: ev(true, "Свидетельство СРО", "Членство подтверждено"),
    projectExperienceConfirmed: ev(true, "Портфолио проектов", "Опыт подтверждён"),
    approvalsConfirmed: ev(true, "Согласования", "Согласования и экспертиза подтверждены"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const designSurveysInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validDesignSurveysInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validDesignSurveysInput.data, ...overrides },
    answers: { ...validDesignSurveysInput.answers },
    evidence,
  };
};
