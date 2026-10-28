import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { automobileInput, ev, validAutomobileInput } from "./fixtures.ts";
import { automobileModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("automobiles: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(automobileModule), []);
});

test("automobiles: полный комплект готовит заявку", () => {
  const result = runFlow(automobileModule, validAutomobileInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("automobiles: 223-ФЗ не поддерживается", () => {
  const result = runFlow(automobileModule, automobileInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("automobiles: другой объект закупки не проходит модуль", () => {
  const result = runFlow(automobileModule, automobileInput({ productKind: "furniture" }));

  assert.equal(result.outcome, "report");
});

test("automobiles: без регистрации участника нужен ввод", () => {
  const result = runFlow(automobileModule, automobileInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("automobiles: характеристики не совпали — не участвовать", () => {
  const result = runFlow(
    automobileModule,
    automobileInput({
      productCharacteristics: [
        { name: "Тип двигателя", value: "Дизель" },
        { name: "Мощность", value: 160, unit: "л.с." },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("automobiles: без подтверждения VIN нужен ввод", () => {
  const result = runFlow(automobileModule, automobileInput({}, { vinConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "vinConfirmed"), true);
});

test("automobiles: VIN не подтверждён — не участвовать", () => {
  const result = runFlow(
    automobileModule,
    automobileInput({}, { vinConfirmed: ev(false, "ПТС и VIN", "VIN не найден") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("automobiles: год выпуска раньше требуемого — отчёт", () => {
  const result = runFlow(automobileModule, automobileInput({ vehicleYear: 2020 }));

  assert.equal(result.outcome, "report");
});

test("automobiles: пробег больше допустимого — отчёт", () => {
  const result = runFlow(automobileModule, automobileInput({ vehicleMileage: 80_000 }));

  assert.equal(result.outcome, "report");
});

test("automobiles: правовой статус не подтверждён — не участвовать", () => {
  const result = runFlow(
    automobileModule,
    automobileInput({}, { legalStatusConfirmed: ev(false, "Выписка из реестра", "найден залог") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("automobiles: поставка позже срока — отчёт", () => {
  const result = runFlow(automobileModule, automobileInput({ deliveryOfferedDate: "2026-12-30" }));

  assert.equal(result.outcome, "report");
});
