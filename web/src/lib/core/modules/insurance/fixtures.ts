import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validInsuranceInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 500_000,
    subject: "Оказание услуг страхования",
    submissionDeadline: "2026-11-28",
    now: "2026-10-26",
    serviceKind: "insurance",
    requiredServiceCharacteristics: [
      { name: "Вид страхования", value: "ОСАГО" },
      { name: "Срок", value: 12, unit: "месяцев", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "вид страхования", value: "осаго" },
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
    licenseRequired: true,
    insuranceRulesRequired: true,
    reinsuranceRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 5_000,
    applicationSecurityAmount: 5_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 25_000,
    contractSecurityAmount: 25_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 350_000,
    offerPrice: 450_000,
    travelCost: 0,
    subcontractCost: 20_000,
    otherCost: 5_000,
    serviceRequiredDate: "2026-12-31",
    serviceOfferedDate: "2026-12-15",
    maxServiceDays: 30,
    serviceDays: 20,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Страхование» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    insuranceServiceMatch: ev(true, "Таблица сопоставления", "Требования к услуге соответствуют ТЗ"),
    licenseConfirmed: ev(true, "Лицензия страховщика", "Лицензия действует"),
    insuranceRulesConfirmed: ev(true, "Правила страхования", "Правила и тарифы подтверждены"),
    reinsuranceConfirmed: ev(true, "Договор перестрахования", "Перестрахование подтверждено"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const insuranceInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validInsuranceInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validInsuranceInput.data, ...overrides },
    answers: { ...validInsuranceInput.answers },
    evidence,
  };
};
