import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, foodInput, validFoodInput } from "./fixtures.ts";
import { foodModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("food: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(foodModule), []);
});

test("food: полный комплект готовит заявку", () => {
  const result = runFlow(foodModule, validFoodInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("food: 223-ФЗ не поддерживается", () => {
  const result = runFlow(foodModule, foodInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("food: другой объект закупки не проходит модуль", () => {
  const result = runFlow(foodModule, foodInput({ productKind: "stationery" }));

  assert.equal(result.outcome, "report");
});

test("food: без регистрации участника нужен ввод", () => {
  const result = runFlow(foodModule, foodInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("food: характеристики не совпали — не участвовать", () => {
  const result = runFlow(
    foodModule,
    foodInput({
      productCharacteristics: [
        { name: "Наименование", value: "Кефир" },
        { name: "Жирность", value: 3.5, unit: "%" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("food: без декларации соответствия нужен ввод", () => {
  const result = runFlow(foodModule, foodInput({}, { conformityDocument: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "conformityDocument"), true);
});

test("food: соответствие не подтверждено — не участвовать", () => {
  const result = runFlow(
    foodModule,
    foodInput({}, { conformityDocument: ev(false, "Декларация соответствия", "не найдена") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("food: остаточный срок годности меньше требуемого — отчёт", () => {
  const result = runFlow(foodModule, foodInput({ offeredShelfLifeDays: 5 }));

  assert.equal(result.outcome, "report");
});

test("food: условия хранения не подтверждены — отчёт", () => {
  const result = runFlow(
    foodModule,
    foodInput({}, { storageConfirmed: ev(false, "Условия хранения", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("food: без ветеринарного сертификата нужен ввод", () => {
  const result = runFlow(foodModule, foodInput({}, { veterinaryConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "veterinaryConfirmed"), true);
});

test("food: ветеринарный сертификат не подтверждён — отчёт", () => {
  const result = runFlow(
    foodModule,
    foodInput({}, { veterinaryConfirmed: ev(false, "Ветеринарный сертификат", "не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("food: поставка позже срока — отчёт", () => {
  const result = runFlow(foodModule, foodInput({ deliveryOfferedDate: "2026-12-30" }));

  assert.equal(result.outcome, "report");
});
