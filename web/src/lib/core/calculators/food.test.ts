import assert from "node:assert/strict";
import { test } from "node:test";
import { foodCalculator } from "./food.ts";
import { sampleLogisticsInput, testStandardCalculator } from "./test-helpers.ts";
import { validFoodInput } from "../modules/food/fixtures.ts";

testStandardCalculator("food", foodCalculator, validFoodInput.data, sampleLogisticsInput);

test("food: запас по остаточному сроку годности считается на golden-фикстуре", () => {
  const result = foodCalculator.calculate({ ...validFoodInput.data, riskScore: 0 });
  const headroom = result.values.find((item) => item.key === "shelfLife.headroom");
  assert.ok(headroom);
  assert.equal(typeof headroom!.value, "number");
  assert.ok(Number.isFinite(headroom!.value as number));
});

test("food: срок годности меньше требуемого даёт отрицательный запас", () => {
  const result = foodCalculator.calculate({ ...validFoodInput.data, offeredShelfLifeDays: 1, riskScore: 0 });
  const headroom = result.values.find((item) => item.key === "shelfLife.headroom");
  assert.ok(typeof headroom!.value === "number" && (headroom!.value as number) < 0);
});

test("food: доставка считается по расстоянию и тарифу", () => {
  const result = foodCalculator.calculate({ ...validFoodInput.data, ...sampleLogisticsInput, riskScore: 0 });
  const delivery = result.values.find((item) => item.key === "delivery.deliveryCost");
  assert.equal(delivery?.value, 300 * 60);
});
