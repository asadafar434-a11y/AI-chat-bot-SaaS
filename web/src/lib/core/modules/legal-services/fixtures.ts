import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validLegalServicesInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 1_000_000,
    subject: "Оказание юридических услуг и аудит",
    submissionDeadline: "2026-12-02",
    now: "2026-10-26",
    serviceKind: "legal_services",
    requiredServiceCharacteristics: [
      { name: "Вид услуги", value: "Юридическое сопровождение" },
      { name: "Срок", value: 12, unit: "месяцев", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "вид услуги", value: "юридическое сопровождение" },
      { name: "Срок", value: 12, unit: "месяцев" },
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
    membershipRequired: true,
    industryExperienceRequired: true,
    conflictCheckRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 10_000,
    applicationSecurityAmount: 10_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 50_000,
    contractSecurityAmount: 50_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 700_000,
    offerPrice: 900_000,
    travelCost: 10_000,
    subcontractCost: 50_000,
    otherCost: 10_000,
    serviceRequiredDate: "2027-01-01",
    serviceOfferedDate: "2026-12-25",
    maxServiceDays: 60,
    serviceDays: 45,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Юрсервис» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    "legal-servicesServiceMatch": ev(true, "Таблица сопоставления", "Требования к услуге соответствуют ТЗ"),
    membershipConfirmed: ev(true, "Свидетельство СРО", "Членство подтверждено"),
    industryExperienceConfirmed: ev(true, "Реестр контрактов", "Отраслевой опыт подтверждён"),
    conflictCheckConfirmed: ev(true, "Декларация конфликта", "Конфликт интересов отсутствует"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const legalServicesInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validLegalServicesInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validLegalServicesInput.data, ...overrides },
    answers: { ...validLegalServicesInput.answers },
    evidence,
  };
};
