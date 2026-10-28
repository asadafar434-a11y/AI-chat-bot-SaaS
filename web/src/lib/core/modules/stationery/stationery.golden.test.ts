import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { stationeryInput, validStationeryInput } from "./fixtures.ts";
import { stationeryModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("stationery: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(stationeryModule), []);
});

test("stationery: полный комплект готовит заявку", () => {
  const result = runFlow(stationeryModule, validStationeryInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("stationery: 223-ФЗ не поддерживается", () => {
  const result = runFlow(stationeryModule, stationeryInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("stationery: другой объект закупки не проходит модуль", () => {
  const result = runFlow(stationeryModule, stationeryInput({ productKind: "furniture" }));

  assert.equal(result.outcome, "report");
});

test("stationery: без регистрации участника нужен ввод", () => {
  const result = runFlow(stationeryModule, stationeryInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("stationery: характеристики не совпали — не участвовать", () => {
  const result = runFlow(
    stationeryModule,
    stationeryInput({
      productCharacteristics: [
        { name: "Плотность", value: 70, unit: "г/м²" },
        { name: "Формат", value: "A4" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("stationery: гарантия не подтверждена — не готовит заявку", () => {
  const result = runFlow(stationeryModule, stationeryInput({}, { warrantyIncluded: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "warrantyIncluded"), true);
});

test("stationery: поставка позже срока — отчёт", () => {
  const result = runFlow(stationeryModule, stationeryInput({ deliveryOfferedDate: "2026-12-20" }));

  assert.equal(result.outcome, "report");
});

test("stationery: обеспечение заявки меньше требуемого — отчёт", () => {
  const result = runFlow(stationeryModule, stationeryInput({ applicationSecurityAmount: 1_000 }));

  assert.equal(result.outcome, "report");
});

test("stationery: отрицательная маржа — отчёт", () => {
  const result = runFlow(stationeryModule, stationeryInput({ offerPrice: 125_000 }));

  assert.equal(result.outcome, "report");
});
