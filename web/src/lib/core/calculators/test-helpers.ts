import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalculatorDescriptor, CalculatorInput } from "./types.ts";

/** Реалистичный пример для «Себестоимости исполнения» (услуги) — используется в golden-тестах. */
export const sampleExecutionCostInput: CalculatorInput = {
  headcount: 10,
  avgMonthlySalary: 75_000,
  payrollTaxRate: 30.2,
  equipmentMonthlyCost: 150_000,
  otherMonthlyCost: 50_000,
  months: 12,
  reservePercent: 8,
  marginPercent: 10,
};

/** Реалистичный пример для «Доставки и монтажа» (товары) — используется в golden-тестах. */
export const sampleLogisticsInput: CalculatorInput = {
  deliveryDistanceKm: 300,
  deliveryRatePerKm: 60,
  deliveryTripsCount: 1,
  installationCrewSize: 2,
  installationDays: 1,
  installationDailyRate: 4_000,
};

/**
 * Общая батарея тестов для «стандартного» калькулятора сферы (цена/маржа + обеспечение +
 * срок + риск): нормальный сценарий на существующей golden-фикстуре модуля, нехватка
 * данных (пустой вход — должен вернуть needsInput, а не бросить исключение) и граница
 * (убыточная цена — маржа отрицательная, но не NaN/Infinity). Любой `<sphere>.test.ts`
 * вызывает это один раз, чтобы не копировать одну и ту же проверку 24 раза.
 */
export function testStandardCalculator(
  label: string,
  descriptor: CalculatorDescriptor,
  goldenInput: CalculatorInput,
  extraInput: CalculatorInput = {},
): void {
  test(`${label}: sourceUrls и ruleIds не пустые`, () => {
    assert.ok(descriptor.ruleIds.length > 0, "ruleIds пустой");
    assert.ok(descriptor.sourceUrls.length > 0, "sourceUrls пустой");
  });

  test(`${label}: нормальный сценарий считает цену, маржу и срок на golden-фикстуре`, () => {
    const result = descriptor.calculate({ ...goldenInput, ...extraInput, riskScore: 0 });
    assert.equal(result.needsInput.length, 0, JSON.stringify(result.needsInput));
    const margin = result.values.find((item) => item.key === "price.margin");
    assert.ok(margin, "нет значения price.margin");
    assert.equal(typeof margin!.value, "number");
    assert.ok(Number.isFinite(margin!.value as number));
    const riskBand = result.values.find((item) => item.key === "risk.riskBand");
    assert.equal(riskBand?.value, "low");
  });

  test(`${label}: пустой вход не бросает исключение и возвращает needsInput`, () => {
    let result: ReturnType<typeof descriptor.calculate> | undefined;
    assert.doesNotThrow(() => {
      result = descriptor.calculate({});
    });
    assert.ok(result);
    assert.ok(result!.needsInput.length > 0);
    for (const value of result!.values) {
      if (typeof value.value === "number") assert.ok(Number.isFinite(value.value), `${value.key} не числовое значение`);
    }
  });

  test(`${label}: убыточная цена даёт отрицательную маржу без NaN/Infinity`, () => {
    const result = descriptor.calculate({ ...goldenInput, cost: 2_000_000, offerPrice: 1_000_000, riskScore: 0 });
    const margin = result.values.find((item) => item.key === "price.margin");
    assert.ok(margin);
    assert.equal(typeof margin!.value, "number");
    assert.ok(Number.isFinite(margin!.value as number));
    assert.ok((margin!.value as number) < 0);
  });
}
