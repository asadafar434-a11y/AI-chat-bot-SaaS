import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { furnitureInput, validFurnitureInput } from "./fixtures.ts";
import { furnitureModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("furniture: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(furnitureModule), []);
});

test("furniture: полный комплект готовит заявку", () => {
  const result = runFlow(furnitureModule, validFurnitureInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("furniture: 223-ФЗ не поддерживается", () => {
  const result = runFlow(furnitureModule, furnitureInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("furniture: другой объект закупки не проходит модуль", () => {
  const result = runFlow(furnitureModule, furnitureInput({ productKind: "office_equipment" }));

  assert.equal(result.outcome, "report");
});

test("furniture: без регистрации участника нужен ввод", () => {
  const result = runFlow(furnitureModule, furnitureInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("furniture: характеристики не совпали — не участвовать", () => {
  const result = runFlow(
    furnitureModule,
    furnitureInput({
      productCharacteristics: [
        { name: "Материал", value: "МДФ" },
        { name: "Ширина", value: 140, unit: "см" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("furniture: гарантия не подтверждена — не готовит заявку", () => {
  const result = runFlow(furnitureModule, furnitureInput({}, { warrantyIncluded: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "warrantyIncluded"), true);
});

test("furniture: поставка позже срока — отчёт", () => {
  const result = runFlow(furnitureModule, furnitureInput({ deliveryOfferedDate: "2026-12-20" }));

  assert.equal(result.outcome, "report");
});

test("furniture: обеспечение заявки меньше требуемого — отчёт", () => {
  const result = runFlow(furnitureModule, furnitureInput({ applicationSecurityAmount: 5_000 }));

  assert.equal(result.outcome, "report");
});

test("furniture: отрицательная маржа — отчёт", () => {
  const result = runFlow(furnitureModule, furnitureInput({ offerPrice: 580_000 }));

  assert.equal(result.outcome, "report");
});
