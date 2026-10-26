import type { EvidenceValue, FlowInput } from "../../flow/types.ts";

export const ev = (value: unknown, source: string, quote = ""): EvidenceValue => ({ value, source, quote });

export const noAdditionalCosts = {
  logisticsCost: 0,
  installationCost: 0,
  warrantyCost: 0,
  coldChainCost: 0,
  otherCost: 0,
};

export const validRegistryRecord = {
  registrationNumber: "РУ № ФСЗ 2026/12345",
  status: "active",
  model: "Модель-1",
  manufacturer: "Пример",
  source: "Реестр Росздравнадзора",
  checkedAt: "2026-10-26",
};

export const validMedicalInput: FlowInput = {
  data: {
    law: "44-ФЗ",
    nmck: 1_000_000,
    subject: "Поставка медицинского оборудования",
    submissionDeadline: "2026-11-15",
    now: "2026-10-26",
    productKind: "device",
    isMedicalDevice: true,
    registrationCertificate: "РУ № ФСЗ 2026/12345",
    registrationCoversModel: true,
    registrationModel: "Модель-1",
    registrationManufacturer: "Пример",
    manufacturer: "Пример",
    model: "Модель-1",
    nationalRegimeApplies: true,
    countryOfOrigin: "RU",
    originConfirmed: true,
    characteristicsMatch: true,
    requiredCharacteristics: [
      { name: "Масса", value: 10, unit: "кг" },
      { name: "Режим работы", value: "непрерывный" },
    ],
    productCharacteristics: [
      { name: "масса", value: 10, unit: "кг" },
      { name: "Режим  работы", value: "Непрерывный" },
    ],
    registryEntry: true,
    registryRecord: validRegistryRecord,
    technicalPassport: true,
    manualRussian: true,
    completenessConfirmed: true,
    participantDeclaration: true,
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
    passportRequired: true,
    manualRequired: true,
    conformityRequired: false,
    conformityDocument: false,
    verificationRequired: false,
    verificationDocument: false,
    installationRequired: true,
    installationIncluded: true,
    warrantyRequired: true,
    warrantyIncluded: true,
    dealerAuthorizationRequired: false,
    dealerAuthorization: false,
    qualityCertificateRequired: false,
    qualityCertificate: false,
    maintenanceRequired: true,
    maintenanceLicense: true,
    medicalActivityRequired: false,
    medicalActivityLicense: false,
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
    logisticsCost: 20_000,
    installationCost: 30_000,
    warrantyCost: 10_000,
    coldChainCost: 5_000,
    otherCost: 5_000,
    deliveryTerms: "Доставка включена",
    warrantyTerms: "12 месяцев",
  },
  answers: {},
  evidence: {
    registrationCertificate: ev("РУ № ФСЗ 2026/12345", "РУ № ФСЗ 2026/12345", "Медицинское изделие «Модель-1»"),
    registrationCoversModel: ev(true, "РУ № ФСЗ 2026/12345", "Модель-1, производитель Пример"),
    originConfirmed: ev(true, "Сертификат происхождения", "Страна происхождения: Россия"),
    participantDeclaration: ev(true, "Декларация участника", "Соответствует требованиям"),
    participantRegistration: ev(true, "Выписка ЕГРЮЛ", "ООО «Пример» зарегистрировано"),
    signatoryAuthority: ev(true, "Приказ и доверенность", "Подписант уполномочен"),
    restrictionsClear: ev(true, "Декларация участника", "Ограничения отсутствуют"),
    bankDetails: ev(true, "Реквизиты счёта", "Расчётный счёт указан"),
    characteristicsMatch: ev(true, "Таблица сопоставления", "Все характеристики соответствуют ТЗ"),
    registryEntry: ev(true, "Реестр Росздравнадзора", "РУ № ФСЗ 2026/12345 действует"),
    technicalPassport: ev(true, "Технический паспорт", "Заводской номер 123"),
    manualRussian: ev(true, "Руководство по эксплуатации", "На русском языке"),
    completenessConfirmed: ev(true, "Спецификация комплекта", "Комплектность соответствует"),
    installationIncluded: ev(true, "Коммерческое предложение", "Монтаж и обучение включены"),
    warrantyIncluded: ev(true, "Коммерческое предложение", "Гарантия 12 месяцев"),
    maintenanceLicense: ev(true, "Лицензия на ТО", "Лицензия действует"),
    applicationSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение заявки"),
    contractSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение контракта"),
  },
};

export const medicalInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {}
): FlowInput => {
  const evidence = { ...(validMedicalInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validMedicalInput.data, ...overrides },
    answers: { ...validMedicalInput.answers },
    evidence,
  };
};

export const validMedicineInput: FlowInput = {
  data: {
    ...validMedicalInput.data,
    productKind: "medicine",
    isMedicalDevice: false,
    medicineRegistration: "ЛП-№(000123)-(РГ-RU) 2026",
    medicineRegistrationRecord: {
      registrationNumber: "ЛП-№(000123)-(РГ-RU) 2026",
      status: "active",
      name: "Пример препарата",
      form: "таблетки",
      dosage: "10 мг",
      manufacturer: "Пример",
      source: "Реестр лекарственных средств",
      checkedAt: "2026-10-26",
    },
    medicineName: "Пример препарата",
    medicineForm: "таблетки",
    medicineDosage: "10 мг",
    medicineManufacturer: "Пример",
    medicineRegistrationMatches: true,
    medicineCharacteristicsMatch: true,
    zhvnlpApplies: true,
    zhvnlpMaxPrice: 950_000,
    vatRateExpected: 10,
    vatRate: 10,
    priceRegistrationRequired: true,
    priceRegistrationConfirmed: true,
    markupLimitApplies: true,
    wholesaleMarkupPercent: 12,
    maxWholesaleMarkupPercent: 15,
    shelfLifeRequired: true,
    requiredShelfLifeMonths: 12,
    shelfLifeMonths: 18,
    coldChainRequired: true,
    coldChainConfirmed: true,
    markingRequired: true,
    markingConfirmed: true,
    pharmacyLicenseRequired: true,
    pharmacyLicense: true,
  },
  answers: { ...validMedicalInput.answers },
  evidence: {
    ...(validMedicalInput.evidence ?? {}),
    medicineRegistration: ev("ЛП-№(000123)-(РГ-RU) 2026", "РУ лекарственного препарата", "Препарат зарегистрирован"),
    medicineRegistrationMatches: ev(true, "РУ лекарственного препарата", "Форма, дозировка и производитель совпадают"),
    medicineCharacteristicsMatch: ev(true, "Таблица сопоставления", "Характеристики соответствуют ТЗ"),
    zhvnlpMaxPrice: ev(950_000, "Реестр ЖНВЛП", "Предельная цена 950 000"),
    vatRateExpected: ev(10, "Налоговая ставка", "Применимая ставка 10%"),
    priceRegistrationConfirmed: ev(true, "Реестр цен", "Предельная цена зарегистрирована"),
    maxWholesaleMarkupPercent: ev(15, "Региональный акт", "Предельная оптовая надбавка 15%"),
    coldChainConfirmed: ev(true, "Термолог", "Температурный режим соблюдён"),
    markingConfirmed: ev(true, "Честный знак", "Маркировка нанесена"),
    pharmacyLicense: ev(true, "Лицензия", "Фармацевтическая деятельность"),
  },
};

export const medicineInput = (
  overrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, EvidenceValue | null> = {}
): FlowInput => {
  const evidence = { ...(validMedicineInput.evidence ?? {}) };
  for (const [key, value] of Object.entries(evidenceOverrides)) {
    if (value === null) delete evidence[key];
    else evidence[key] = value;
  }
  return {
    data: { ...validMedicineInput.data, ...overrides },
    answers: { ...validMedicineInput.answers },
    evidence,
  };
};
