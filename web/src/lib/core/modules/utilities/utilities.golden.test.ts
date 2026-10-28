import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, utilitiesInput, validUtilitiesInput } from "./fixtures.ts";
import { utilitiesModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("utilities: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(utilitiesModule), []);
});

test("utilities: полный комплект готовит заявку", () => {
  const result = runFlow(utilitiesModule, validUtilitiesInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("utilities: 223-ФЗ не поддерживается", () => {
  const result = runFlow(utilitiesModule, utilitiesInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("utilities: другая услуга не проходит модуль", () => {
  const result = runFlow(utilitiesModule, utilitiesInput({ serviceKind: "energy" }));

  assert.equal(result.outcome, "report");
});

test("utilities: без регистрации участника нужен ввод", () => {
  const result = runFlow(utilitiesModule, utilitiesInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("utilities: требования к услуге не совпали — не участвовать", () => {
  const result = runFlow(
    utilitiesModule,
    utilitiesInput({
      offeredServiceCharacteristics: [
        { name: "Ресурс", value: "Теплоснабжение" },
        { name: "Объём", value: 600, unit: "м³" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("utilities: без подтверждения статуса поставщика нужен ввод", () => {
  const result = runFlow(utilitiesModule, utilitiesInput({}, { providerConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "providerConfirmed"), true);
});

test("utilities: статус поставщика не подтверждён — не участвовать", () => {
  const result = runFlow(
    utilitiesModule,
    utilitiesInput({}, { providerConfirmed: ev(false, "Статус поставщика", "не подтверждён") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("utilities: тариф не подтверждён — отчёт", () => {
  const result = runFlow(
    utilitiesModule,
    utilitiesInput({}, { tariffConfirmed: ev(false, "Тарифное решение", "не подтверждено") }),
  );

  assert.equal(result.outcome, "report");
});

test("utilities: без SLA нужен ввод", () => {
  const result = runFlow(utilitiesModule, utilitiesInput({}, { slaConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "slaConfirmed"), true);
});

test("utilities: SLA не подтверждён — отчёт", () => {
  const result = runFlow(
    utilitiesModule,
    utilitiesInput({}, { slaConfirmed: ev(false, "Регламент SLA", "не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("utilities: срок оказания услуг позже требуемого — отчёт", () => {
  const result = runFlow(utilitiesModule, utilitiesInput({ serviceOfferedDate: "2027-01-15" }));

  assert.equal(result.outcome, "report");
});
