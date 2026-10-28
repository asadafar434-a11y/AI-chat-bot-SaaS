import assert from "node:assert/strict";
import { test } from "node:test";
import { medicalDeviceCalculator, medicalMedicineCalculator } from "./medical.ts";
import { testStandardCalculator } from "./test-helpers.ts";
import { validMedicalInput, validMedicineInput } from "../modules/medical/fixtures.ts";

testStandardCalculator("medical.device", medicalDeviceCalculator, validMedicalInput.data);
testStandardCalculator("medical.medicine", medicalMedicineCalculator, validMedicineInput.data);

test("medical.device: сверка РУ с реестром подтверждена на golden-фикстуре", () => {
  const result = medicalDeviceCalculator.calculate({ ...validMedicalInput.data, riskScore: 0 });
  const matched = result.values.find((item) => item.key === "registryMatch.matched");
  assert.equal(matched?.value, true);
});

test("medical.device: несовпадение модели даёт причину несовпадения, не исключение", () => {
  const result = medicalDeviceCalculator.calculate({ ...validMedicalInput.data, model: "Другая модель", riskScore: 0 });
  const matched = result.values.find((item) => item.key === "registryMatch.matched");
  const reasons = result.values.find((item) => item.key === "registryMatch.reasons");
  assert.equal(matched?.value, false);
  assert.ok(typeof reasons?.value === "string" && (reasons.value as string).length > 0);
});

test("medical.device: комплект документов после контракта зависит от условий закупки", () => {
  const result = medicalDeviceCalculator.calculate({ ...validMedicalInput.data, riskScore: 0 });
  const items = result.values.filter((item) => item.key.startsWith("postAward."));
  assert.ok(items.length > 0);
  assert.ok(items.some((item) => item.key === "postAward.device-warranty"));
});

test("medical.medicine: ЖНВЛП, НДС, оптовая надбавка и срок годности считаются на golden-фикстуре", () => {
  const result = medicalMedicineCalculator.calculate({
    ...validMedicineInput.data,
    priceExcludingVat: validMedicineInput.data.offerPrice,
    riskScore: 0,
  });
  const zhvnlpHeadroom = result.values.find((item) => item.key === "zhvnlp.headroom");
  // zhvnlpMaxPrice 950000, offerPrice 900000 → запас 50000
  assert.equal(zhvnlpHeadroom?.value, 50_000);

  const vatAmount = result.values.find((item) => item.key === "vat.vatAmount");
  assert.equal(typeof vatAmount?.value, "number");
  assert.ok(Number.isFinite(vatAmount!.value as number));

  const markupHeadroom = result.values.find((item) => item.key === "markup.headroomPercent");
  // maxWholesaleMarkupPercent 15, wholesaleMarkupPercent 12 → запас 3
  assert.equal(markupHeadroom?.value, 3);

  const shelfLifeHeadroom = result.values.find((item) => item.key === "shelfLife.headroomMonths");
  // shelfLifeMonths 18, requiredShelfLifeMonths 12 → запас 6
  assert.equal(shelfLifeHeadroom?.value, 6);
});

test("medical.medicine: цена выше предельной ЖНВЛП даёт отрицательный запас, не исключение", () => {
  const result = medicalMedicineCalculator.calculate({ ...validMedicineInput.data, offerPrice: 1_200_000, riskScore: 0 });
  const headroom = result.values.find((item) => item.key === "zhvnlp.headroom");
  assert.ok(typeof headroom!.value === "number" && (headroom!.value as number) < 0);
});
