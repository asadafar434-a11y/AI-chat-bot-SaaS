import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const validRealEstateInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 10_000_000,
    subject: "Приобретение объекта недвижимости",
    submissionDeadline: "2026-12-08",
    now: "2026-10-26",
    serviceKind: "real_estate",
    requiredServiceCharacteristics: [
      { name: "Тип объекта", value: "Нежилое помещение" },
      { name: "Площадь", value: 500, unit: "м²", op: "gte" },
    ],
    offeredServiceCharacteristics: [
      { name: "тип объекта", value: "нежилое помещение" },
      { name: "Площадь", value: 550, unit: "м²" },
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
    legalStatusRequired: true,
    cadastreRequired: true,
    technicalRequired: true,
    applicationSecurityRequired: true,
    applicationSecurityProvided: true,
    applicationSecurityRequiredAmount: 100_000,
    applicationSecurityAmount: 100_000,
    applicationSecurityFormRequired: "банковская гарантия",
    applicationSecurityForm: "банковская гарантия",
    applicationSecurityRequiredUntil: "2027-01-01",
    applicationSecurityValidUntil: "2027-06-01",
    contractSecurityRequired: true,
    contractSecurityProvided: true,
    contractSecurityRequiredAmount: 500_000,
    contractSecurityAmount: 500_000,
    contractSecurityFormRequired: "банковская гарантия",
    contractSecurityForm: "банковская гарантия",
    contractSecurityRequiredUntil: "2028-01-01",
    contractSecurityValidUntil: "2028-06-01",
    antidumpingSecurityProvided: false,
    priceJustificationProvided: false,
    cost: 7_000_000,
    offerPrice: 9_000_000,
    travelCost: 0,
    subcontractCost: 100_000,
    otherCost: 50_000,
    serviceRequiredDate: "2027-06-01",
    serviceOfferedDate: "2027-05-01",
    maxServiceDays: 180,
    serviceDays: 150,
  },
  answers: {},
  evidence: {
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Недвижимость» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    "real-estateServiceMatch": ev(true, "Таблица сопоставления", "Требования к объекту соответствуют ТЗ"),
    legalStatusConfirmed: ev(true, "Выписка ЕГРН", "Обременений нет"),
    cadastreConfirmed: ev(true, "Кадастровые документы", "Учёт подтверждён"),
    technicalConfirmed: ev(true, "Техническое заключение", "Состояние подтверждено"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const realEstateInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {},
): FlowInput => {
  const evidence = { ...(validRealEstateInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validRealEstateInput.data, ...overrides },
    answers: { ...validRealEstateInput.answers },
    evidence,
  };
};
