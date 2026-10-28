import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, itCommunicationsInput, validItCommunicationsInput } from "./fixtures.ts";
import { itCommunicationsModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("it-communications: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(itCommunicationsModule), []);
});

test("it-communications: полный комплект готовит заявку", () => {
  const result = runFlow(itCommunicationsModule, validItCommunicationsInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("it-communications: 223-ФЗ не поддерживается", () => {
  const result = runFlow(itCommunicationsModule, itCommunicationsInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("it-communications: другая услуга не проходит модуль", () => {
  const result = runFlow(itCommunicationsModule, itCommunicationsInput({ serviceKind: "training" }));

  assert.equal(result.outcome, "report");
});

test("it-communications: без регистрации участника нужен ввод", () => {
  const result = runFlow(
    itCommunicationsModule,
    itCommunicationsInput({}, { participantRegistration: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("it-communications: требования к услуге не совпали — не участвовать", () => {
  const result = runFlow(
    itCommunicationsModule,
    itCommunicationsInput({
      offeredServiceCharacteristics: [
        { name: "Услуга", value: "Телефония" },
        { name: "Скорость", value: 200, unit: "Мбит/с" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("it-communications: без лицензии нужен ввод", () => {
  const result = runFlow(itCommunicationsModule, itCommunicationsInput({}, { licenseConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "licenseConfirmed"), true);
});

test("it-communications: лицензия не подтверждена — не участвовать", () => {
  const result = runFlow(
    itCommunicationsModule,
    itCommunicationsInput({}, { licenseConfirmed: ev(false, "Лицензия оператора связи", "отсутствует") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("it-communications: SLA не подтверждён — отчёт", () => {
  const result = runFlow(
    itCommunicationsModule,
    itCommunicationsInput({}, { slaConfirmed: ev(false, "Регламент SLA", "не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("it-communications: без подтверждения защиты информации нужен ввод", () => {
  const result = runFlow(itCommunicationsModule, itCommunicationsInput({}, { securityConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "securityConfirmed"), true);
});

test("it-communications: защита информации не подтверждена — отчёт", () => {
  const result = runFlow(
    itCommunicationsModule,
    itCommunicationsInput({}, { securityConfirmed: ev(false, "Защита информации", "не подтверждена") }),
  );

  assert.equal(result.outcome, "report");
});

test("it-communications: срок оказания услуг позже требуемого — отчёт", () => {
  const result = runFlow(
    itCommunicationsModule,
    itCommunicationsInput({ serviceOfferedDate: "2027-01-15" }),
  );

  assert.equal(result.outcome, "report");
});
