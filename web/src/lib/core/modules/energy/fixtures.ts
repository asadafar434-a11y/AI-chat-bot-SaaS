import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validEnergyInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 1_200_000,
    subject: "Поставка энергоресурсов",
    submissionDeadline: "2026-12-04",
    now: "2026-10-26",
    serviceKind: "energy",
    requiredServiceCharacteristics: [
      { name: "Ресурс", value: "Электроэнергия" },
      { name: "Мощность", value: 100, unit: "кВт", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "ресурс", value: "электроэнергия" },
      { name: "Мощность", value: 120, unit: "кВт" },
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
    tariffRequired: true,
    connectionRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 12_000,
    applicationSecurityAmount: 12_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 60_000,
    contractSecurityAmount: 60_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 800_000,
    offerPrice: 1_050_000,
    travelCost: 0,
    subcontractCost: 50_000,
    otherCost: 20_000,
    serviceRequiredDate: "2027-01-01",
    serviceOfferedDate: "2026-12-20",
    maxServiceDays: 60,
    serviceDays: 45,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Энерго» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    energyServiceMatch: ev(true, "Таблица сопоставления", "Требования к ресурсу соответствуют ТЗ"),
    licenseConfirmed: ev(true, "Лицензия", "Статус поставщика подтверждён"),
    tariffConfirmed: ev(true, "Тарифное решение", "Тариф подтверждён"),
    connectionConfirmed: ev(true, "Документы присоединения", "Присоединение подтверждено"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const energyInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validEnergyInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validEnergyInput.data, ...overrides },
    answers: { ...validEnergyInput.answers },
    evidence,
  };
};
