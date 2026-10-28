import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, toroInput, validToroInput } from "./fixtures.ts";
import { toroModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("toro: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(toroModule), []);
});

test("toro: полный комплект готовит заявку", () => {
  const result = runFlow(toroModule, validToroInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("toro: 223-ФЗ не поддерживается", () => {
  const result = runFlow(toroModule, toroInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("toro: другая услуга не проходит модуль", () => {
  const result = runFlow(toroModule, toroInput({ serviceKind: "it_communications" }));

  assert.equal(result.outcome, "report");
});

test("toro: без регистрации участника нужен ввод", () => {
  const result = runFlow(toroModule, toroInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("toro: требования к услуге не совпали — не участвовать", () => {
  const result = runFlow(
    toroModule,
    toroInput({
      offeredServiceCharacteristics: [
        { name: "Оборудование", value: "Принтеры" },
        { name: "Срок реакции", value: 3, unit: "часа" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("toro: без авторизации нужен ввод", () => {
  const result = runFlow(toroModule, toroInput({}, { authorizationConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "authorizationConfirmed"), true);
});

test("toro: авторизация не подтверждена — отчёт", () => {
  const result = runFlow(
    toroModule,
    toroInput({}, { authorizationConfirmed: ev(false, "Авторизация производителя", "отсутствует") }),
  );

  assert.equal(result.outcome, "report");
});

test("toro: запасные части не подтверждены — отчёт", () => {
  const result = runFlow(
    toroModule,
    toroInput({}, { sparePartsConfirmed: ev(false, "Наличие запчастей", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("toro: без SLA нужен ввод", () => {
  const result = runFlow(toroModule, toroInput({}, { slaConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "slaConfirmed"), true);
});

test("toro: SLA не подтверждён — отчёт", () => {
  const result = runFlow(
    toroModule,
    toroInput({}, { slaConfirmed: ev(false, "Регламент SLA", "не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("toro: срок услуг позже требуемого — отчёт", () => {
  const result = runFlow(toroModule, toroInput({ serviceOfferedDate: "2027-01-15" }));

  assert.equal(result.outcome, "report");
});
