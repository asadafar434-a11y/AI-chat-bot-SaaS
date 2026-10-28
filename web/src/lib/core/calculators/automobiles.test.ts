import assert from "node:assert/strict";
import { test } from "node:test";
import { automobilesCalculator } from "./automobiles.ts";
import { testStandardCalculator } from "./test-helpers.ts";
import { validAutomobileInput } from "../modules/automobiles/fixtures.ts";

testStandardCalculator("automobiles", automobilesCalculator, validAutomobileInput.data);

test("automobiles: запас по году и пробегу считается на golden-фикстуре", () => {
  const result = automobilesCalculator.calculate({ ...validAutomobileInput.data, riskScore: 0 });
  const yearHeadroom = result.values.find((item) => item.key === "vehicleYear.headroom");
  const mileageHeadroom = result.values.find((item) => item.key === "vehicleMileage.headroom");
  // фикстура: minYear 2022, vehicleYear 2023 → запас 1; maxMileage 50000, vehicleMileage 30000 → запас 20000
  assert.equal(yearHeadroom?.value, 1);
  assert.equal(mileageHeadroom?.value, 20_000);
});

test("automobiles: пробег выше допустимого даёт отрицательный запас, не исключение", () => {
  const result = automobilesCalculator.calculate({ ...validAutomobileInput.data, vehicleMileage: 90_000, riskScore: 0 });
  const mileageHeadroom = result.values.find((item) => item.key === "vehicleMileage.headroom");
  assert.equal(mileageHeadroom?.value, -40_000);
});
