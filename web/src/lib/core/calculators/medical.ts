import type { CalculatorDescriptor, CalculatorInput, CalculatorResult } from "./types.ts";
import {
  buildCalculatorContext,
  field,
  inferFieldKind,
  readBoolean,
  readNumber,
  requireModule,
  requireRule,
  roundMoney,
  roundPercent,
  ruleSourceUrls,
} from "./support.ts";
import { createStandardCalculators, type CalculatorPart, type StandardCalculatorsConfig } from "./common.ts";
import { buildPostAwardChecklist, type PostAwardInput } from "../modules/medical/post-award.ts";
import { checkRegistryRecord } from "../modules/medical/registry.ts";

const SPHERE_KEY = "medical";

const deviceConfig: StandardCalculatorsConfig = {
  sphereKey: SPHERE_KEY,
  subSphereKey: "device",
  sphereLabel: "Медизделия",
  kind: "goods",
  lowRiskRuleId: "internal.low_risk",
  extraCostFields: [{ key: "coldChainCost", label: "Холодовая цепь" }],
};

const medicineConfig: StandardCalculatorsConfig = {
  sphereKey: SPHERE_KEY,
  subSphereKey: "medicine",
  sphereLabel: "Лекарства",
  kind: "goods",
  lowRiskRuleId: "internal.low_risk",
  extraCostFields: [{ key: "coldChainCost", label: "Холодовая цепь" }],
  // У лекарства нет монтажа и гарантии (вместо гарантии — срок годности).
  omitCostFields: ["installationCost", "warrantyCost"],
};

function missingResult(explanation: string, keys: string[], ruleIds: string[], sourceUrls: string[]): CalculatorResult {
  return {
    values: [],
    explanation,
    usedInputs: [],
    ruleIds,
    sourceUrls,
    needsInput: keys.map((key) => ({ key, label: key, kind: inferFieldKind(key), required: true })),
    warnings: [],
  };
}

/** Предельная цена ЖНВЛП (61-ФЗ ст. 61). Саму границу берём из evidence (справочник) —
 * калькулятор её не придумывает, только вычитает. */
function createZhvnlpCalculator(): CalculatorDescriptor {
  const coreModule = requireModule(SPHERE_KEY);
  const ruleId = "medicine.zhvnlp";
  const sourceUrls = ruleSourceUrls(coreModule, [ruleId]);
  return {
    sphereKey: SPHERE_KEY,
    subSphereKey: "medicine",
    title: "Предельная цена ЖНВЛП",
    description: "Запас цены предложения до подтверждённой предельной отпускной цены ЖНВЛП.",
    inputSchema: [
      { key: "zhvnlpApplies", label: "Входит в ЖНВЛП", kind: "boolean", required: true },
      { key: "zhvnlpMaxPrice", label: "Предельная цена (подтверждённая)", kind: "number", required: false, unit: "₽" },
      { key: "offerPrice", label: "Цена предложения", kind: "number", required: false, unit: "₽" },
    ],
    outputSchema: [
      { key: "headroom", label: "Запас до предельной цены", kind: "number", required: false, unit: "₽" },
      { key: "compliant", label: "Не выше предельной цены", kind: "boolean", required: false },
    ],
    ruleIds: [ruleId],
    sourceUrls,
    calculate: (input: CalculatorInput): CalculatorResult => {
      const rule = requireRule(coreModule, ruleId);
      const evaluation = rule.evaluate(buildCalculatorContext(input));
      if (evaluation.missing.length > 0) return missingResult(evaluation.detail, evaluation.missing, [ruleId], sourceUrls);
      const limit = readNumber(input, "zhvnlpMaxPrice");
      const offerPrice = readNumber(input, "offerPrice");
      const headroom = limit !== null && offerPrice !== null ? roundMoney(limit - offerPrice) : null;
      return {
        values: [
          field("headroom", "Запас до предельной цены", headroom, "₽"),
          field("compliant", "Не выше предельной цены", evaluation.passed),
        ],
        explanation: evaluation.detail,
        usedInputs: ["zhvnlpApplies", "zhvnlpMaxPrice", "offerPrice"].filter((key) => input[key] !== undefined),
        ruleIds: [ruleId],
        sourceUrls,
        needsInput: [],
        warnings: [],
      };
    },
  };
}

/** НДС (НК РФ ст. 164). Ожидаемую ставку берём из evidence; калькулятор только умножает,
 * ставку не придумывает. */
function createVatCalculator(): CalculatorDescriptor {
  const coreModule = requireModule(SPHERE_KEY);
  const ruleId = "medicine.vat_rate";
  const sourceUrls = ruleSourceUrls(coreModule, [ruleId]);
  return {
    sphereKey: SPHERE_KEY,
    subSphereKey: "medicine",
    title: "НДС на лекарственный препарат",
    description: "Сумма НДС и цена с НДС по фактической ставке; сверка ставки с подтверждённой ожидаемой.",
    inputSchema: [
      { key: "vatRateExpected", label: "Ожидаемая ставка НДС (подтверждённая)", kind: "number", required: true, unit: "%" },
      { key: "vatRate", label: "Ставка НДС в предложении", kind: "number", required: true, unit: "%" },
      { key: "priceExcludingVat", label: "Цена без НДС", kind: "number", required: false, unit: "₽" },
    ],
    outputSchema: [
      { key: "vatAmount", label: "Сумма НДС", kind: "number", required: false, unit: "₽" },
      { key: "priceIncludingVat", label: "Цена с НДС", kind: "number", required: false, unit: "₽" },
      { key: "compliant", label: "Ставка совпадает с ожидаемой", kind: "boolean", required: false },
    ],
    ruleIds: [ruleId],
    sourceUrls,
    calculate: (input: CalculatorInput): CalculatorResult => {
      const rule = requireRule(coreModule, ruleId);
      const evaluation = rule.evaluate(buildCalculatorContext(input));
      if (evaluation.missing.length > 0) return missingResult(evaluation.detail, evaluation.missing, [ruleId], sourceUrls);
      const priceExcludingVat = readNumber(input, "priceExcludingVat");
      const vatRate = readNumber(input, "vatRate");
      const vatAmount = priceExcludingVat !== null && vatRate !== null ? roundMoney((priceExcludingVat * vatRate) / 100) : null;
      const priceIncludingVat = priceExcludingVat !== null && vatAmount !== null ? roundMoney(priceExcludingVat + vatAmount) : null;
      return {
        values: [
          field("vatAmount", "Сумма НДС", vatAmount, "₽"),
          field("priceIncludingVat", "Цена с НДС", priceIncludingVat, "₽"),
          field("compliant", "Ставка совпадает с ожидаемой", evaluation.passed),
        ],
        explanation: evaluation.detail,
        usedInputs: ["vatRateExpected", "vatRate", "priceExcludingVat"].filter((key) => input[key] !== undefined),
        ruleIds: [ruleId],
        sourceUrls,
        needsInput: [],
        warnings: [],
      };
    },
  };
}

/** Оптовая надбавка (61-ФЗ ст. 63). Предел берём из evidence (региональный акт);
 * калькулятор умножает уже подтверждённый предел, не придумывает его. */
function createWholesaleMarkupCalculator(): CalculatorDescriptor {
  const coreModule = requireModule(SPHERE_KEY);
  const ruleId = "medicine.markup";
  const sourceUrls = ruleSourceUrls(coreModule, [ruleId]);
  return {
    sphereKey: SPHERE_KEY,
    subSphereKey: "medicine",
    title: "Оптовая надбавка на лекарственный препарат",
    description: "Предельная цена с учётом оптовой надбавки и запас до фактической надбавки.",
    inputSchema: [
      { key: "markupLimitApplies", label: "Предельная надбавка применяется", kind: "boolean", required: true },
      { key: "maxWholesaleMarkupPercent", label: "Предельная надбавка (подтверждённая)", kind: "number", required: false, unit: "%" },
      { key: "wholesaleMarkupPercent", label: "Фактическая надбавка", kind: "number", required: false, unit: "%" },
      { key: "zhvnlpMaxPrice", label: "Базовая цена (предельная ЖНВЛП)", kind: "number", required: false, unit: "₽" },
    ],
    outputSchema: [
      { key: "maxWholesalePrice", label: "Предельная цена с надбавкой", kind: "number", required: false, unit: "₽" },
      { key: "headroomPercent", label: "Запас по надбавке", kind: "number", required: false, unit: "%" },
      { key: "compliant", label: "Надбавка не выше предельной", kind: "boolean", required: false },
    ],
    ruleIds: [ruleId],
    sourceUrls,
    calculate: (input: CalculatorInput): CalculatorResult => {
      const rule = requireRule(coreModule, ruleId);
      const evaluation = rule.evaluate(buildCalculatorContext(input));
      if (evaluation.missing.length > 0) return missingResult(evaluation.detail, evaluation.missing, [ruleId], sourceUrls);
      const limit = readNumber(input, "maxWholesaleMarkupPercent");
      const actual = readNumber(input, "wholesaleMarkupPercent");
      const basePrice = readNumber(input, "zhvnlpMaxPrice");
      const maxWholesalePrice = basePrice !== null && limit !== null ? roundMoney(basePrice * (1 + limit / 100)) : null;
      const headroomPercent = limit !== null && actual !== null ? roundPercent(limit - actual) : null;
      return {
        values: [
          field("maxWholesalePrice", "Предельная цена с надбавкой", maxWholesalePrice, "₽"),
          field("headroomPercent", "Запас по надбавке", headroomPercent, "%"),
          field("compliant", "Надбавка не выше предельной", evaluation.passed),
        ],
        explanation: evaluation.detail,
        usedInputs: ["markupLimitApplies", "maxWholesaleMarkupPercent", "wholesaleMarkupPercent", "zhvnlpMaxPrice"].filter((key) => input[key] !== undefined),
        ruleIds: [ruleId],
        sourceUrls,
        needsInput: [],
        warnings: [],
      };
    },
  };
}

/** Остаточный срок годности (44-ФЗ ст. 33), в месяцах. */
function createShelfLifeCalculator(): CalculatorDescriptor {
  const coreModule = requireModule(SPHERE_KEY);
  const ruleId = "medicine.shelf_life";
  const sourceUrls = ruleSourceUrls(coreModule, [ruleId]);
  return {
    sphereKey: SPHERE_KEY,
    subSphereKey: "medicine",
    title: "Остаточный срок годности",
    description: "Запас или недостаток остаточного срока годности в месяцах против требования закупки.",
    inputSchema: [
      { key: "shelfLifeRequired", label: "Требование к сроку годности установлено", kind: "boolean", required: true },
      { key: "requiredShelfLifeMonths", label: "Требуемый остаточный срок", kind: "number", required: false, unit: "мес." },
      { key: "shelfLifeMonths", label: "Остаточный срок препарата", kind: "number", required: false, unit: "мес." },
    ],
    outputSchema: [
      { key: "headroomMonths", label: "Запас по сроку", kind: "number", required: false, unit: "мес." },
      { key: "compliant", label: "Соответствует требованию", kind: "boolean", required: false },
    ],
    ruleIds: [ruleId],
    sourceUrls,
    calculate: (input: CalculatorInput): CalculatorResult => {
      const rule = requireRule(coreModule, ruleId);
      const evaluation = rule.evaluate(buildCalculatorContext(input));
      if (evaluation.missing.length > 0) return missingResult(evaluation.detail, evaluation.missing, [ruleId], sourceUrls);
      const required = readNumber(input, "requiredShelfLifeMonths");
      const remaining = readNumber(input, "shelfLifeMonths");
      const headroomMonths = required !== null && remaining !== null ? remaining - required : null;
      return {
        values: [
          field("headroomMonths", "Запас по сроку", headroomMonths, "мес."),
          field("compliant", "Соответствует требованию", evaluation.passed),
        ],
        explanation: evaluation.detail,
        usedInputs: ["shelfLifeRequired", "requiredShelfLifeMonths", "shelfLifeMonths"].filter((key) => input[key] !== undefined),
        ruleIds: [ruleId],
        sourceUrls,
        needsInput: [],
        warnings: [],
      };
    },
  };
}

/** Сверка РУ медизделия со структурированной записью реестра. Переиспользует само правило
 * `medical.registration.matches` для да/нет-ответа (включая его запасные пути — сверку по
 * `registrationCoversModel`, если структурированной записи нет) и ту же функцию
 * `checkRegistryRecord`, чтобы показать причины несовпадения построчно. Имена полей — ровно
 * те, что использует правило: `isMedicalDevice`, `registryRecord`, `registrationCertificate`,
 * `model`, `manufacturer` (см. web/src/lib/core/modules/medical/rules.ts). */
function createRegistryMatchCalculator(): CalculatorDescriptor {
  const coreModule = requireModule(SPHERE_KEY);
  const ruleId = "medical.registration.matches";
  const sourceUrls = ruleSourceUrls(coreModule, [ruleId]);
  return {
    sphereKey: SPHERE_KEY,
    subSphereKey: "device",
    title: "Сверка РУ с реестром медизделий",
    description: "Сверяет номер РУ, модель и производителя со структурированной записью реестра.",
    inputSchema: [
      { key: "isMedicalDevice", label: "Это медицинское изделие", kind: "boolean", required: true },
      { key: "registryRecord", label: "Запись реестра", kind: "string", required: false },
      { key: "registrationCertificate", label: "Номер РУ", kind: "string", required: false },
      { key: "model", label: "Модель", kind: "string", required: false },
      { key: "manufacturer", label: "Производитель", kind: "string", required: false },
    ],
    outputSchema: [
      { key: "matched", label: "Реестр подтверждает", kind: "boolean", required: false },
      { key: "reasons", label: "Причины несовпадения", kind: "string", required: false },
    ],
    ruleIds: [ruleId],
    sourceUrls,
    calculate: (input: CalculatorInput): CalculatorResult => {
      const rule = requireRule(coreModule, ruleId);
      const evaluation = rule.evaluate(buildCalculatorContext(input));
      if (evaluation.missing.length > 0) return missingResult(evaluation.detail, evaluation.missing, [ruleId], sourceUrls);
      const record = input.registryRecord;
      const registrationNumber = typeof input.registrationCertificate === "string" ? input.registrationCertificate : "";
      let reasons: string[] = [];
      if (record !== undefined && record !== null && registrationNumber) {
        reasons = checkRegistryRecord(record, {
          registrationNumber,
          model: typeof input.model === "string" ? input.model : undefined,
          manufacturer: typeof input.manufacturer === "string" ? input.manufacturer : undefined,
        }).reasons;
      }
      return {
        values: [
          field("matched", "Реестр подтверждает", evaluation.passed),
          field("reasons", "Причины несовпадения", reasons.join(", ") || null),
        ],
        explanation: evaluation.detail,
        usedInputs: ["isMedicalDevice", "registryRecord", "registrationCertificate", "model", "manufacturer"].filter((key) => input[key] !== undefined),
        ruleIds: [ruleId],
        sourceUrls,
        needsInput: [],
        warnings: [],
      };
    },
  };
}

/** Достаточность документов после заключения контракта — переиспользует чистую функцию
 * `buildPostAwardChecklist` напрямую; это генератор чек-листа, а не обёртка над правилом. */
function createPostAwardChecklistCalculator(subSphereKey: "device" | "medicine"): CalculatorDescriptor {
  return {
    sphereKey: SPHERE_KEY,
    subSphereKey,
    title: subSphereKey === "device" ? "Комплект документов после контракта — медизделия" : "Комплект документов после контракта — лекарства",
    description: "Список документов, которые нужно подготовить после заключения контракта, по условиям закупки.",
    // Монтаж, поверка, ТО и гарантия — у медизделий; у лекарств после контракта остаются холодовая цепь и маркировка.
    inputSchema: [
      { key: "installationRequired", label: "Требуется монтаж", kind: "boolean" as const, required: false },
      { key: "verificationRequired", label: "Требуется поверка", kind: "boolean" as const, required: false },
      { key: "maintenanceRequired", label: "Требуется ТО", kind: "boolean" as const, required: false },
      { key: "warrantyRequired", label: "Требуется гарантия", kind: "boolean" as const, required: false },
      { key: "coldChainRequired", label: "Требуется холодовая цепь", kind: "boolean" as const, required: false },
      { key: "markingRequired", label: "Требуется маркировка", kind: "boolean" as const, required: false },
    ].filter((f) => subSphereKey === "device" || ["coldChainRequired", "markingRequired"].includes(f.key)),
    outputSchema: [{ key: "items", label: "Документы", kind: "string", required: false }],
    ruleIds: ["medical.device.registry_entry"],
    sourceUrls: ["Внутренняя политика Core v1"],
    calculate: (input: CalculatorInput): CalculatorResult => {
      const postAwardInput: PostAwardInput = {
        productKind: subSphereKey,
        installationRequired: readBoolean(input, "installationRequired") ?? undefined,
        verificationRequired: readBoolean(input, "verificationRequired") ?? undefined,
        maintenanceRequired: readBoolean(input, "maintenanceRequired") ?? undefined,
        warrantyRequired: readBoolean(input, "warrantyRequired") ?? undefined,
        coldChainRequired: readBoolean(input, "coldChainRequired") ?? undefined,
        markingRequired: readBoolean(input, "markingRequired") ?? undefined,
      };
      const items = buildPostAwardChecklist(postAwardInput);
      return {
        values: items.map((item) => field(item.id, item.title, item.reason)),
        explanation: `Документов в комплекте: ${items.length}`,
        usedInputs: Object.keys(input),
        ruleIds: ["medical.device.registry_entry"],
        sourceUrls: ["Внутренняя политика Core v1"],
        needsInput: [],
        warnings: [],
      };
    },
  };
}

const deviceExtraParts: CalculatorPart[] = [
  { section: "registryMatch", descriptor: createRegistryMatchCalculator() },
  { section: "postAward", descriptor: createPostAwardChecklistCalculator("device") },
];

const medicineExtraParts: CalculatorPart[] = [
  { section: "zhvnlp", descriptor: createZhvnlpCalculator() },
  { section: "vat", descriptor: createVatCalculator() },
  { section: "markup", descriptor: createWholesaleMarkupCalculator() },
  { section: "shelfLife", descriptor: createShelfLifeCalculator() },
  { section: "postAward", descriptor: createPostAwardChecklistCalculator("medicine") },
];

export const medicalDeviceCalculator: CalculatorDescriptor = createStandardCalculators(deviceConfig, deviceExtraParts);
export const medicalMedicineCalculator: CalculatorDescriptor = createStandardCalculators(medicineConfig, medicineExtraParts);

export const medicalCalculators: CalculatorDescriptor[] = [medicalDeviceCalculator, medicalMedicineCalculator];
