import type { CalculatorDescriptor, CalculatorFieldSchema, CalculatorInput, CalculatorResult } from "./types.ts";
import {
  buildCalculatorContext,
  field,
  inferFieldKind,
  readNumber,
  requireCalcNode,
  requireModule,
  requireRule,
  roundMoney,
  roundPercent,
  ruleSourceUrls,
} from "./support.ts";

export type GoodsOrService = "goods" | "service";

export type StandardCalculatorsConfig = {
  sphereKey: string;
  subSphereKey: string;
  sphereLabel: string;
  kind: GoodsOrService;
  /** Id правила итогового порога риска; у ручного модуля `medical` оно называется иначе. */
  lowRiskRuleId?: string;
  /** Дополнительные поля затрат, которые модульный узел `calc.price` суммирует (например, `coldChainCost` у медицины). */
  extraCostFields?: { key: string; label: string }[];
  /**
   * Поля затрат товарной сферы, которых в ней не бывает: «Монтаж» у канцтоваров, продуктов, автомобилей и лекарств, «Гарантия» у продуктов, спецодежды и лекарств.
   * Поле не показывается и не просится; расчёт читает его как ноль, как и раньше, когда оно не заполнено.
   */
  omitCostFields?: ("installationCost" | "warrantyCost")[];
};

const scheduleFieldNames = (kind: GoodsOrService) =>
  kind === "goods"
    ? {
        requiredDate: "deliveryRequiredDate",
        offeredDate: "deliveryOfferedDate",
        maxDays: "maxDeliveryDays",
        days: "deliveryDays",
        ruleSuffix: "delivery_schedule",
      }
    : {
        requiredDate: "serviceRequiredDate",
        offeredDate: "serviceOfferedDate",
        maxDays: "maxServiceDays",
        days: "serviceDays",
        ruleSuffix: "schedule",
      };

function missingResult(explanation: string, needsInput: CalculatorFieldSchema[], ruleIds: string[], sourceUrls: string[]): CalculatorResult {
  return { values: [], explanation, usedInputs: [], ruleIds, sourceUrls, needsInput, warnings: [] };
}

/** Убирает из полей цены те, что в этой сфере не бывают (config.omitCostFields). */
function dropOmittedCostFields(config: StandardCalculatorsConfig, fields: CalculatorFieldSchema[]): CalculatorFieldSchema[] {
  const omit: string[] = config.omitCostFields ?? [];
  return fields.filter((f) => !omit.includes(f.key));
}

/** Цена, маржа и порог антидемпинга — напрямую использует узел `calc.price` самого модуля. */
export function createPriceMarginCalculator(config: StandardCalculatorsConfig): CalculatorDescriptor {
  const { sphereKey, subSphereKey, sphereLabel } = config;
  const ruleIds = [`${sphereKey}.margin`, `${sphereKey}.antidumping`];
  const coreModule = requireModule(sphereKey);
  const sourceUrls = ruleSourceUrls(coreModule, ruleIds);
  return {
    sphereKey,
    subSphereKey,
    title: `Цена и маржа — ${sphereLabel}`,
    description: "Себестоимость, дополнительные затраты, маржа и порог антидемпинга (ст. 37 44-ФЗ) по правилам модуля.",
    inputSchema: dropOmittedCostFields(config, [
      { key: "cost", label: "Себестоимость", kind: "number", required: true, unit: "₽" },
      { key: "offerPrice", label: "Цена предложения", kind: "number", required: true, unit: "₽" },
      { key: "nmck", label: "НМЦК", kind: "number", required: true, unit: "₽" },
      ...(config.kind === "goods"
        ? [
            { key: "logisticsCost", label: "Логистика", kind: "number" as const, required: false, unit: "₽" },
            { key: "installationCost", label: "Монтаж", kind: "number" as const, required: false, unit: "₽" },
            { key: "warrantyCost", label: "Гарантия", kind: "number" as const, required: false, unit: "₽" },
          ]
        : [
            { key: "travelCost", label: "Командировочные", kind: "number" as const, required: false, unit: "₽" },
            { key: "subcontractCost", label: "Субподряд", kind: "number" as const, required: false, unit: "₽" },
          ]),
      ...(config.extraCostFields ?? []).map((item) => ({ key: item.key, label: item.label, kind: "number" as const, required: false, unit: "₽" })),
      { key: "otherCost", label: "Прочие затраты", kind: "number" as const, required: false, unit: "₽" },
    ]),
    outputSchema: [
      { key: "additionalCosts", label: "Дополнительные затраты", kind: "number", required: false, unit: "₽" },
      { key: "totalCost", label: "Полная себестоимость", kind: "number", required: false, unit: "₽" },
      { key: "margin", label: "Маржа", kind: "number", required: false, unit: "₽" },
      { key: "marginPercent", label: "Маржа", kind: "number", required: false, unit: "%" },
      { key: "antidumpingThreshold", label: "Порог антидемпинга (75% НМЦК)", kind: "number", required: false, unit: "₽" },
    ],
    ruleIds,
    sourceUrls,
    calculate: (input: CalculatorInput): CalculatorResult => {
      const node = requireCalcNode(coreModule, "calc.price");
      const context = buildCalculatorContext(input);
      const result = node.compute(context);
      if (result.missing && result.missing.length > 0) {
        const labels: Record<string, string> = {
          cost: "Себестоимость",
          offerPrice: "Цена предложения",
          nmck: "НМЦК",
          logisticsCost: "Логистика",
          installationCost: "Монтаж",
          warrantyCost: "Гарантия",
          coldChainCost: "Холодовая цепь",
          travelCost: "Командировочные",
          subcontractCost: "Субподряд",
          otherCost: "Прочие затраты",
        };
        return missingResult(
          result.detail ?? "Недостаточно данных для расчёта цены",
          result.missing.map((key) => ({ key, label: labels[key] ?? key, kind: "number", required: true })),
          ruleIds,
          sourceUrls,
        );
      }
      const additionalCosts = Number(result.outputs.additionalCosts);
      const totalCost = Number(result.outputs.totalCost);
      const margin = Number(result.outputs.margin);
      const marginPercent = result.outputs.marginPercent === null ? null : Number(result.outputs.marginPercent);
      const antidumpingThreshold = Number(result.outputs.antidumpingThreshold);
      return {
        values: [
          field("additionalCosts", "Дополнительные затраты", roundMoney(additionalCosts), "₽"),
          field("totalCost", "Полная себестоимость", roundMoney(totalCost), "₽"),
          field("margin", "Маржа", roundMoney(margin), "₽"),
          field("marginPercent", "Маржа", marginPercent === null ? null : roundPercent(marginPercent), "%"),
          field("antidumpingThreshold", "Порог антидемпинга (75% НМЦК)", roundMoney(antidumpingThreshold), "₽"),
        ],
        explanation: result.detail ?? "Расчёт выполнен",
        usedInputs: ["cost", "offerPrice", "nmck", "logisticsCost", "installationCost", "warrantyCost", "coldChainCost", "travelCost", "subcontractCost", "otherCost"].filter(
          (key) => input[key] !== undefined,
        ),
        ruleIds,
        sourceUrls,
        needsInput: [],
        warnings: [],
      };
    },
  };
}

function createSecurityCalculator(config: StandardCalculatorsConfig, phase: "application" | "contract"): CalculatorDescriptor {
  const { sphereKey, subSphereKey, sphereLabel } = config;
  const ruleId = `${sphereKey}.security.${phase}`;
  const coreModule = requireModule(sphereKey);
  const sourceUrls = ruleSourceUrls(coreModule, [ruleId]);
  const prefix = phase === "application" ? "applicationSecurity" : "contractSecurity";
  const phaseLabel = phase === "application" ? "заявки" : "исполнения контракта";
  return {
    sphereKey,
    subSphereKey,
    title: `Обеспечение ${phaseLabel} — ${sphereLabel}`,
    description: `Сумма, форма и срок обеспечения ${phaseLabel} против требования закупки.`,
    inputSchema: [
      { key: `${prefix}Required`, label: "Обеспечение требуется", kind: "boolean", required: true },
      { key: `${prefix}RequiredAmount`, label: "Требуемая сумма", kind: "number", required: false, unit: "₽" },
      { key: `${prefix}Amount`, label: "Предложенная сумма", kind: "number", required: false, unit: "₽" },
      { key: `${prefix}Provided`, label: "Обеспечение подтверждено", kind: "boolean", required: false },
    ],
    outputSchema: [
      { key: "requiredAmount", label: "Требуемая сумма", kind: "number", required: false, unit: "₽" },
      { key: "amount", label: "Предложенная сумма", kind: "number", required: false, unit: "₽" },
      { key: "shortfall", label: "Недостаёт", kind: "number", required: false, unit: "₽" },
      { key: "compliant", label: "Соответствует требованию", kind: "boolean", required: false },
    ],
    ruleIds: [ruleId],
    sourceUrls,
    calculate: (input: CalculatorInput): CalculatorResult => {
      const rule = requireRule(coreModule, ruleId);
      const context = buildCalculatorContext(input);
      const evaluation = rule.evaluate(context);
      if (evaluation.missing.length > 0) {
        return missingResult(
          evaluation.detail,
          evaluation.missing.map((key) => ({ key, label: key, kind: inferFieldKind(key), required: true })),
          [ruleId],
          sourceUrls,
        );
      }
      const requiredAmount = readNumber(input, `${prefix}RequiredAmount`);
      const amount = readNumber(input, `${prefix}Amount`);
      const shortfall = requiredAmount !== null && amount !== null ? roundMoney(Math.max(requiredAmount - amount, 0)) : null;
      return {
        values: [
          field("requiredAmount", "Требуемая сумма", requiredAmount === null ? null : roundMoney(requiredAmount), "₽"),
          field("amount", "Предложенная сумма", amount === null ? null : roundMoney(amount), "₽"),
          field("shortfall", "Недостаёт", shortfall, "₽"),
          field("compliant", "Соответствует требованию", evaluation.passed),
        ],
        explanation: evaluation.detail,
        usedInputs: Object.keys(input).filter((key) => key.startsWith(prefix)),
        ruleIds: [ruleId],
        sourceUrls,
        needsInput: [],
        warnings: [],
      };
    },
  };
}

export function createApplicationSecurityCalculator(config: StandardCalculatorsConfig): CalculatorDescriptor {
  return createSecurityCalculator(config, "application");
}

export function createContractSecurityCalculator(config: StandardCalculatorsConfig): CalculatorDescriptor {
  return createSecurityCalculator(config, "contract");
}

/** Срок поставки/оказания услуг — использует правило `${sphereKey}.delivery_schedule`/`.schedule`. */
export function createScheduleCalculator(config: StandardCalculatorsConfig): CalculatorDescriptor {
  const { sphereKey, subSphereKey, sphereLabel, kind } = config;
  const names = scheduleFieldNames(kind);
  const ruleId = `${sphereKey}.${names.ruleSuffix}`;
  const coreModule = requireModule(sphereKey);
  const sourceUrls = ruleSourceUrls(coreModule, [ruleId]);
  const noun = kind === "goods" ? "поставки" : "оказания услуг";
  return {
    sphereKey,
    subSphereKey,
    title: `Срок ${noun} — ${sphereLabel}`,
    description: `Запас или просрочка по сроку ${noun} против требования закупки (ст. 33 44-ФЗ).`,
    inputSchema: [
      { key: names.requiredDate, label: "Требуемая дата", kind: "date", required: false },
      { key: names.offeredDate, label: "Предлагаемая дата", kind: "date", required: false },
      { key: names.maxDays, label: "Допустимый срок, дней", kind: "number", required: false },
      { key: names.days, label: "Предлагаемый срок, дней", kind: "number", required: false },
    ],
    outputSchema: [
      { key: "headroomDays", label: "Запас по сроку", kind: "number", required: false, unit: "дн." },
      { key: "compliant", label: "Соответствует требованию", kind: "boolean", required: false },
    ],
    ruleIds: [ruleId],
    sourceUrls,
    calculate: (input: CalculatorInput): CalculatorResult => {
      const rule = requireRule(coreModule, ruleId);
      const context = buildCalculatorContext(input);
      const evaluation = rule.evaluate(context);
      if (evaluation.missing.length > 0) {
        return missingResult(
          evaluation.detail,
          evaluation.missing.map((key) => ({ key, label: key, kind: inferFieldKind(key), required: true })),
          [ruleId],
          sourceUrls,
        );
      }
      const requiredDate = input[names.requiredDate];
      const offeredDate = input[names.offeredDate];
      let headroomDays: number | null = null;
      if (typeof requiredDate === "string" && typeof offeredDate === "string") {
        const requiredTime = Date.parse(requiredDate);
        const offeredTime = Date.parse(offeredDate);
        if (!Number.isNaN(requiredTime) && !Number.isNaN(offeredTime)) {
          headroomDays = Math.round((requiredTime - offeredTime) / 86_400_000);
        }
      } else {
        const maxDays = readNumber(input, names.maxDays);
        const days = readNumber(input, names.days);
        if (maxDays !== null && days !== null) headroomDays = maxDays - days;
      }
      return {
        values: [
          field("headroomDays", "Запас по сроку", headroomDays, "дн."),
          field("compliant", "Соответствует требованию", evaluation.passed),
        ],
        explanation: evaluation.detail,
        usedInputs: [names.requiredDate, names.offeredDate, names.maxDays, names.days].filter((key) => input[key] !== undefined),
        ruleIds: [ruleId],
        sourceUrls,
        needsInput: [],
        warnings: [],
      };
    },
  };
}

export type BoundCalculatorConfig = {
  sphereKey: string;
  subSphereKey: string;
  title: string;
  description: string;
  ruleId: string;
  boundField: string;
  boundLabel: string;
  actualField: string;
  actualLabel: string;
  unit?: string;
  /** "min" — фактическое значение должно быть не меньше границы (пол, например минимальный год выпуска).
   *  "max" — фактическое значение должно быть не больше границы (потолок, например максимальный пробег). */
  direction: "min" | "max";
};

/** Общий калькулятор «фактическое значение против числовой границы» (год/пробег/срок годности):
 * использует само правило сферы для да/нет-проверки, а сверху добавляет только арифметику запаса,
 * которую правило не возвращает. */
export function createBoundCalculator(config: BoundCalculatorConfig): CalculatorDescriptor {
  const { sphereKey, subSphereKey, ruleId, boundField, boundLabel, actualField, actualLabel, unit, direction } = config;
  const coreModule = requireModule(sphereKey);
  const sourceUrls = ruleSourceUrls(coreModule, [ruleId]);
  return {
    sphereKey,
    subSphereKey,
    title: config.title,
    description: config.description,
    inputSchema: [
      { key: boundField, label: boundLabel, kind: "number", required: false, unit },
      { key: actualField, label: actualLabel, kind: "number", required: true, unit },
    ],
    outputSchema: [{ key: "headroom", label: "Запас", kind: "number", required: false, unit }],
    ruleIds: [ruleId],
    sourceUrls,
    calculate: (input: CalculatorInput): CalculatorResult => {
      const rule = requireRule(coreModule, ruleId);
      const evaluation = rule.evaluate(buildCalculatorContext(input));
      if (evaluation.missing.length > 0) {
        return missingResult(
          evaluation.detail,
          evaluation.missing.map((key) => ({ key, label: key === actualField ? actualLabel : key, kind: inferFieldKind(key), required: true })),
          [ruleId],
          sourceUrls,
        );
      }
      const bound = readNumber(input, boundField);
      const actual = readNumber(input, actualField);
      const headroom = bound !== null && actual !== null ? (direction === "min" ? actual - bound : bound - actual) : null;
      return {
        values: [field("headroom", "Запас", headroom, unit), field("compliant", "Соответствует требованию", evaluation.passed)],
        explanation: evaluation.detail,
        usedInputs: [boundField, actualField].filter((key) => input[key] !== undefined),
        ruleIds: [ruleId],
        sourceUrls,
        needsInput: [],
        warnings: [],
      };
    },
  };
}

/** Итоговый риск — переводит посчитанный балл в полосу по тому же порогу, что и правило
 * `${sphereKey}.low_risk` (риск < 40). Сам балл риска считает вызывающий код (он складывается
 * только из findings полного прогона `runFlow`) — калькулятор лишь оформляет готовое число. */
export function createRiskDecisionCalculator(config: StandardCalculatorsConfig): CalculatorDescriptor {
  const { sphereKey, subSphereKey, sphereLabel } = config;
  const lowRiskRuleId = config.lowRiskRuleId ?? `${sphereKey}.low_risk`;
  const coreModule = requireModule(sphereKey);
  const sourceUrls = ruleSourceUrls(coreModule, [lowRiskRuleId]);
  return {
    sphereKey,
    subSphereKey,
    title: `Итоговый риск — ${sphereLabel}`,
    description: "Переводит посчитанный балл риска в полосу и рекомендацию по порогу модуля (риск < 40 — низкий).",
    inputSchema: [{ key: "riskScore", label: "Балл риска", kind: "number", required: true }],
    outputSchema: [
      { key: "riskScore", label: "Балл риска", kind: "number", required: false },
      { key: "riskBand", label: "Полоса риска", kind: "string", required: false },
      { key: "recommendation", label: "Рекомендация", kind: "string", required: false },
    ],
    ruleIds: [lowRiskRuleId],
    sourceUrls,
    calculate: (input: CalculatorInput): CalculatorResult => {
      const rule = requireRule(coreModule, lowRiskRuleId);
      const context = buildCalculatorContext(input);
      const evaluation = rule.evaluate(context);
      if (evaluation.missing.length > 0) {
        return missingResult(evaluation.detail, [{ key: "riskScore", label: "Балл риска", kind: "number", required: true }], [lowRiskRuleId], sourceUrls);
      }
      const score = readNumber(input, "riskScore") ?? 0;
      const riskBand = score >= 100 ? "blocker" : score >= 40 ? "high" : score >= 15 ? "medium" : "low";
      const recommendation = evaluation.passed
        ? "Риск ниже порога — можно продолжать подготовку заявки"
        : "Риск выше порога — нужно снизить риск или подготовить отчёт";
      return {
        values: [
          field("riskScore", "Балл риска", score),
          field("riskBand", "Полоса риска", riskBand),
          field("recommendation", "Рекомендация", recommendation),
        ],
        explanation: evaluation.detail,
        usedInputs: ["riskScore"],
        ruleIds: [lowRiskRuleId],
        sourceUrls,
        needsInput: [],
        warnings: [],
      };
    },
  };
}

export type CalculatorPart = { section: string; descriptor: CalculatorDescriptor };

/**
 * Склеивает несколько калькуляторов-«деталей» в один составной калькулятор под пару
 * «сфера + под-сфера» — именно такую пару выбирает CLI (`--sphere --subsphere`) и экран `/core`,
 * без третьего переключателя. Каждая деталь считается независимо на одном и том же входе;
 * если деталь говорит, что ей не хватает данных, это попадает в общий `needsInput`,
 * а остальные детали всё равно досчитываются — отсутствие одного числа не блокирует остальные.
 */
export function combineCalculators(
  parts: CalculatorPart[],
  meta: { sphereKey: string; subSphereKey: string; title: string; description: string },
): CalculatorDescriptor {
  const dedupeByKey = <T extends { key: string }>(items: T[]): T[] => {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const item of items) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      result.push(item);
    }
    return result;
  };

  const inputSchema = dedupeByKey(
    parts.flatMap(({ section, descriptor }) => descriptor.inputSchema.map((item) => ({ ...item, section }))),
  );
  const outputSchema = dedupeByKey(
    parts.flatMap(({ section, descriptor }) => descriptor.outputSchema.map((item) => ({ ...item, key: `${section}.${item.key}` }))),
  );
  const ruleIds = [...new Set(parts.flatMap(({ descriptor }) => descriptor.ruleIds))];
  const sourceUrls = [...new Set(parts.flatMap(({ descriptor }) => descriptor.sourceUrls))];

  return {
    sphereKey: meta.sphereKey,
    subSphereKey: meta.subSphereKey,
    title: meta.title,
    description: meta.description,
    inputSchema,
    outputSchema,
    ruleIds,
    sourceUrls,
    calculate: (input: CalculatorInput): CalculatorResult => {
      const values: CalculatorResult["values"] = [];
      const needsInput: CalculatorFieldSchema[] = [];
      const explanations: string[] = [];
      const warnings: string[] = [];
      const usedInputs = new Set<string>();

      for (const { section, descriptor } of parts) {
        const result = descriptor.calculate(input);
        for (const value of result.values) values.push({ ...value, key: `${section}.${value.key}`, label: value.label });
        for (const need of result.needsInput) {
          if (!needsInput.some((item) => item.key === need.key)) needsInput.push(need);
        }
        if (result.explanation) explanations.push(result.explanation);
        for (const warning of result.warnings) warnings.push(warning);
        for (const key of result.usedInputs) usedInputs.add(key);
      }

      return {
        values,
        explanation: explanations.join(" "),
        usedInputs: [...usedInputs],
        ruleIds,
        sourceUrls,
        needsInput,
        warnings,
      };
    },
  };
}

/** Стандартный набор на сферу без явных под-сфер: цена/маржа, обеспечение заявки и контракта,
 * срок исполнения, итоговый риск — плюс любые профильные детали конкретной сферы (например,
 * год/пробег у автомобилей). Соответствует правилу задачи: «нет под-сферы — один общий
 * калькулятор плюс калькуляторы по группам правил», склеенные в одну пару сфера+под-сфера. */
export function createStandardCalculators(config: StandardCalculatorsConfig, extraParts: CalculatorPart[] = []): CalculatorDescriptor {
  const parts: CalculatorPart[] = [
    { section: "price", descriptor: createPriceMarginCalculator(config) },
    { section: "securityApplication", descriptor: createApplicationSecurityCalculator(config) },
    { section: "securityContract", descriptor: createContractSecurityCalculator(config) },
    { section: "schedule", descriptor: createScheduleCalculator(config) },
    { section: "risk", descriptor: createRiskDecisionCalculator(config) },
    ...extraParts,
  ];
  return combineCalculators(parts, {
    sphereKey: config.sphereKey,
    subSphereKey: config.subSphereKey,
    title: `Расчёты закупки — ${config.sphereLabel}`,
    description: "Цена и маржа, обеспечение заявки и контракта, срок исполнения и итоговый риск по правилам модуля.",
  });
}

export type ExecutionCostCalculatorConfig = {
  sphereKey: string;
  subSphereKey: string;
  sphereLabel: string;
  /** Бывает ли в сфере аренда и содержание техники: у страхования, юридических услуг и недвижимости — нет (поле не показывается, считается как ноль). */
  equipment?: boolean;
};

/**
 * Себестоимость исполнения по составу (персонал + техника + резерв + маржа) → цена предложения.
 * Та же модель, что уже работает в продукте для расчёта по составу исполнения (зарплаты из открытых
 * данных, аренда техники, резерв, маржа) — здесь в общем виде: ставки и количества вводит участник,
 * ядро не ходит в сеть и не подбирает цифры само. Один расчёт — один сценарий; для «минимум/реалистично/
 * максимум» нужно запустить расчёт трижды с разными цифрами (дешёвый/средний/дорогой персонал и техника).
 */
export function createExecutionCostCalculator(config: ExecutionCostCalculatorConfig): CalculatorDescriptor {
  const { sphereKey, subSphereKey, sphereLabel } = config;
  const withEquipment = config.equipment !== false;
  return {
    sphereKey,
    subSphereKey,
    title: `Себестоимость исполнения — ${sphereLabel}`,
    description:
      "Зарплата персонала со страховыми взносами, аренда техники, прочие расходы, резерв на непредвиденное и целевая маржа — одним сценарием. Для разброса минимум/реалистично/максимум запустите расчёт несколько раз с разными цифрами.",
    inputSchema: [
      { key: "headcount", label: "Численность персонала", kind: "number", required: true, unit: "чел." },
      { key: "avgMonthlySalary", label: "Средняя зарплата на человека в месяц", kind: "number", required: true, unit: "₽" },
      { key: "payrollTaxRate", label: "Страховые взносы с ФОТ", kind: "number", required: true, unit: "%" },
      ...(withEquipment ? [{ key: "equipmentMonthlyCost", label: "Аренда и содержание техники в месяц", kind: "number" as const, required: false, unit: "₽" }] : []),
      { key: "otherMonthlyCost", label: "Прочие расходы в месяц (ИТ, СИЗ, админ.)", kind: "number", required: false, unit: "₽" },
      { key: "months", label: "Срок исполнения", kind: "number", required: true, unit: "мес." },
      { key: "reservePercent", label: "Резерв на непредвиденное", kind: "number", required: false, unit: "%" },
      { key: "marginPercent", label: "Целевая маржа", kind: "number", required: true, unit: "%" },
      { key: "volume", label: "Объём (для цены за единицу)", kind: "number", required: false },
      { key: "vatRate", label: "Ставка НДС", kind: "number", required: false, unit: "%" },
    ],
    outputSchema: [
      { key: "monthlyPayroll", label: "ФОТ с начислениями в месяц", kind: "number", required: false, unit: "₽" },
      { key: "totalCost", label: "Полная себестоимость со резервом", kind: "number", required: false, unit: "₽" },
      { key: "priceExcludingVat", label: "Цена предложения без НДС", kind: "number", required: false, unit: "₽" },
      { key: "priceIncludingVat", label: "Цена предложения с НДС", kind: "number", required: false, unit: "₽" },
      { key: "pricePerUnit", label: "Цена за единицу объёма", kind: "number", required: false, unit: "₽" },
      { key: "monthlyRevenue", label: "Выручка в месяц", kind: "number", required: false, unit: "₽" },
    ],
    ruleIds: [`${sphereKey}.execution_cost`],
    sourceUrls: ["Внутренняя политика Core v1 — модель себестоимости по составу исполнения"],
    calculate: (input: CalculatorInput): CalculatorResult => {
      const headcount = readNumber(input, "headcount");
      const avgMonthlySalary = readNumber(input, "avgMonthlySalary");
      const payrollTaxRate = readNumber(input, "payrollTaxRate");
      const months = readNumber(input, "months");
      const marginPercent = readNumber(input, "marginPercent");

      const missingRequired: string[] = [];
      if (headcount === null) missingRequired.push("headcount");
      if (avgMonthlySalary === null) missingRequired.push("avgMonthlySalary");
      if (payrollTaxRate === null) missingRequired.push("payrollTaxRate");
      if (months === null) missingRequired.push("months");
      if (marginPercent === null) missingRequired.push("marginPercent");
      if (missingRequired.length > 0) {
        const labels: Record<string, string> = {
          headcount: "Численность персонала",
          avgMonthlySalary: "Средняя зарплата на человека в месяц",
          payrollTaxRate: "Страховые взносы с ФОТ",
          months: "Срок исполнения",
          marginPercent: "Целевая маржа",
        };
        return missingResult(
          "Недостаточно данных для расчёта себестоимости исполнения",
          missingRequired.map((key) => ({ key, label: labels[key] ?? key, kind: "number", required: true })),
          [`${sphereKey}.execution_cost`],
          ["Внутренняя политика Core v1 — модель себестоимости по составу исполнения"],
        );
      }

      const equipmentMonthlyCost = (withEquipment ? readNumber(input, "equipmentMonthlyCost") : null) ?? 0;
      const otherMonthlyCost = readNumber(input, "otherMonthlyCost") ?? 0;
      const reservePercent = readNumber(input, "reservePercent") ?? 0;
      const volume = readNumber(input, "volume");
      const vatRate = readNumber(input, "vatRate");

      const monthlyPayroll = roundMoney(headcount! * avgMonthlySalary! * (1 + payrollTaxRate! / 100));
      const totalPayroll = roundMoney(monthlyPayroll * months!);
      const totalEquipment = roundMoney(equipmentMonthlyCost * months!);
      const totalOther = roundMoney(otherMonthlyCost * months!);
      const subtotal = roundMoney(totalPayroll + totalEquipment + totalOther);
      const reserveAmount = roundMoney(subtotal * (reservePercent / 100));
      const totalCost = roundMoney(subtotal + reserveAmount);
      const priceExcludingVat = roundMoney(totalCost * (1 + marginPercent! / 100));
      const priceIncludingVat = vatRate !== null ? roundMoney(priceExcludingVat * (1 + vatRate / 100)) : null;
      const pricePerUnit = volume !== null && volume > 0 ? roundMoney(priceExcludingVat / volume) : null;
      const monthlyRevenue = roundMoney(priceExcludingVat / months!);

      return {
        values: [
          field("monthlyPayroll", "ФОТ с начислениями в месяц", monthlyPayroll, "₽"),
          field("totalPayroll", "ФОТ с начислениями за весь срок", totalPayroll, "₽"),
          ...(withEquipment ? [field("totalEquipment", "Техника за весь срок", totalEquipment, "₽")] : []),
          field("totalOther", "Прочие расходы за весь срок", totalOther, "₽"),
          field("subtotal", "Итого до резерва", subtotal, "₽"),
          field("reserveAmount", "Резерв", reserveAmount, "₽"),
          field("totalCost", "Полная себестоимость с резервом", totalCost, "₽"),
          field("priceExcludingVat", "Цена предложения без НДС", priceExcludingVat, "₽"),
          field("priceIncludingVat", "Цена предложения с НДС", priceIncludingVat, "₽"),
          field("pricePerUnit", "Цена за единицу объёма", pricePerUnit, "₽"),
          field("monthlyRevenue", "Выручка в месяц", monthlyRevenue, "₽"),
        ],
        explanation: `ФОТ с начислениями: ${monthlyPayroll} ₽/мес. Полная себестоимость с резервом: ${totalCost} ₽. Цена предложения без НДС: ${priceExcludingVat} ₽.`,
        usedInputs: [
          "headcount",
          "avgMonthlySalary",
          "payrollTaxRate",
          ...(withEquipment ? ["equipmentMonthlyCost"] : []),
          "otherMonthlyCost",
          "months",
          "reservePercent",
          "marginPercent",
          "volume",
          "vatRate",
        ].filter((key) => input[key] !== undefined),
        ruleIds: [`${sphereKey}.execution_cost`],
        sourceUrls: ["Внутренняя политика Core v1 — модель себестоимости по составу исполнения"],
        needsInput: [],
        warnings: [],
      };
    },
  };
}

export type DeliveryInstallationCalculatorConfig = {
  sphereKey: string;
  subSphereKey: string;
  sphereLabel: string;
  /** Нужен ли монтаж в этой сфере: мебель, оргтехника, учебное оборудование, медизделия — да; канцтовары, продукты, спецодежда, стройматериалы — нет (тогда только доставка). */
  installation?: boolean;
};

/**
 * Доставка и монтаж — разовые расходы товарной поставки, а не месячный штат (в этом и разница с
 * «Себестоимостью исполнения» услуг: товар доставляют и один раз устанавливают, а не обслуживают
 * месяцами). Расстояние, тариф, состав монтажной бригады и её дневная ставка — всё вводит участник;
 * поля необязательны и дают 0, если доставка/монтаж для конкретного товара не нужны.
 */
export function createDeliveryInstallationCalculator(config: DeliveryInstallationCalculatorConfig): CalculatorDescriptor {
  const { sphereKey, subSphereKey, sphereLabel } = config;
  const withInstallation = config.installation !== false;
  return {
    sphereKey,
    subSphereKey,
    title: withInstallation ? `Доставка и монтаж — ${sphereLabel}` : `Доставка — ${sphereLabel}`,
    description: withInstallation
      ? "Стоимость доставки по расстоянию и тарифу и стоимость монтажной бригады по дневной ставке — разовые расходы на поставку."
      : "Стоимость доставки по расстоянию и тарифу — разовый расход на поставку.",
    inputSchema: [
      { key: "deliveryDistanceKm", label: "Расстояние доставки", kind: "number", required: false, unit: "км" },
      { key: "deliveryRatePerKm", label: "Тариф за км", kind: "number", required: false, unit: "₽/км" },
      { key: "deliveryTripsCount", label: "Число рейсов", kind: "number", required: false },
      ...(withInstallation
        ? [
            { key: "installationCrewSize", label: "Размер монтажной бригады", kind: "number" as const, required: false, unit: "чел." },
            { key: "installationDays", label: "Срок монтажа", kind: "number" as const, required: false, unit: "дн." },
            { key: "installationDailyRate", label: "Дневная ставка монтажника", kind: "number" as const, required: false, unit: "₽/чел./дн." },
            { key: "installationOtherCost", label: "Прочие расходы на монтаж", kind: "number" as const, required: false, unit: "₽" },
          ]
        : []),
    ],
    outputSchema: [
      { key: "deliveryCost", label: "Стоимость доставки", kind: "number", required: false, unit: "₽" },
      ...(withInstallation ? [{ key: "installationCost", label: "Стоимость монтажа", kind: "number" as const, required: false, unit: "₽" }] : []),
      { key: "totalLogisticsCost", label: withInstallation ? "Доставка и монтаж — итого" : "Доставка — итого", kind: "number", required: false, unit: "₽" },
    ],
    ruleIds: [`${sphereKey}.delivery_installation`],
    sourceUrls: ["Внутренняя политика Core v1 — модель стоимости доставки и монтажа"],
    calculate: (input: CalculatorInput): CalculatorResult => {
      const distance = readNumber(input, "deliveryDistanceKm");
      const ratePerKm = readNumber(input, "deliveryRatePerKm");
      const trips = readNumber(input, "deliveryTripsCount") ?? 1;
      const deliveryCost = distance !== null && ratePerKm !== null ? roundMoney(distance * ratePerKm * trips) : null;

      const crewSize = withInstallation ? readNumber(input, "installationCrewSize") : null;
      const days = withInstallation ? readNumber(input, "installationDays") : null;
      const dailyRate = withInstallation ? readNumber(input, "installationDailyRate") : null;
      const otherCost = (withInstallation ? readNumber(input, "installationOtherCost") : null) ?? 0;
      const installationCost =
        crewSize !== null && days !== null && dailyRate !== null ? roundMoney(crewSize * days * dailyRate + otherCost) : otherCost > 0 ? roundMoney(otherCost) : null;

      const totalLogisticsCost =
        deliveryCost !== null || installationCost !== null ? roundMoney((deliveryCost ?? 0) + (installationCost ?? 0)) : null;

      return {
        values: [
          field("deliveryCost", "Стоимость доставки", deliveryCost, "₽"),
          ...(withInstallation ? [field("installationCost", "Стоимость монтажа", installationCost, "₽")] : []),
          field("totalLogisticsCost", withInstallation ? "Доставка и монтаж — итого" : "Доставка — итого", totalLogisticsCost, "₽"),
        ],
        explanation:
          deliveryCost === null && installationCost === null
            ? `${withInstallation ? "Доставка и монтаж не посчитаны" : "Доставка не посчитана"} — поля не заполнены (это необязательные расходы).`
            : `${withInstallation ? "Доставка и монтаж" : "Доставка"} — итого: ${totalLogisticsCost} ₽.`,
        usedInputs: [
          "deliveryDistanceKm",
          "deliveryRatePerKm",
          "deliveryTripsCount",
          ...(withInstallation ? ["installationCrewSize", "installationDays", "installationDailyRate", "installationOtherCost"] : []),
        ].filter((key) => input[key] !== undefined),
        ruleIds: [`${sphereKey}.delivery_installation`],
        sourceUrls: ["Внутренняя политика Core v1 — модель стоимости доставки и монтажа"],
        needsInput: [],
        warnings: [],
      };
    },
  };
}
