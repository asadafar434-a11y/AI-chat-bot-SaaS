import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, transportInput, validTransportInput } from "./fixtures.ts";
import { transportModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("transport: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(transportModule), []);
});

test("transport: полный комплект готовит заявку", () => {
  const result = runFlow(transportModule, validTransportInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("transport: 223-ФЗ не поддерживается", () => {
  const result = runFlow(transportModule, transportInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("transport: другая услуга не проходит модуль", () => {
  const result = runFlow(transportModule, transportInput({ serviceKind: "utilities" }));

  assert.equal(result.outcome, "report");
});

test("transport: без регистрации участника нужен ввод", () => {
  const result = runFlow(transportModule, transportInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("transport: требования к услуге не совпали — не участвовать", () => {
  const result = runFlow(
    transportModule,
    transportInput({
      offeredServiceCharacteristics: [
        { name: "Тип транспорта", value: "Легковой автомобиль" },
        { name: "Количество", value: 5, unit: "ед." },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("transport: без лицензии нужен ввод", () => {
  const result = runFlow(transportModule, transportInput({}, { licenseConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "licenseConfirmed"), true);
});

test("transport: лицензия не подтверждена — не участвовать", () => {
  const result = runFlow(
    transportModule,
    transportInput({}, { licenseConfirmed: ev(false, "Лицензия", "отсутствует") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("transport: транспорт не подтверждён — отчёт", () => {
  const result = runFlow(
    transportModule,
    transportInput({}, { fleetConfirmed: ev(false, "Документы на транспорт", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("transport: без страхования нужен ввод", () => {
  const result = runFlow(transportModule, transportInput({}, { insuranceConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "insuranceConfirmed"), true);
});

test("transport: страхование не подтверждено — отчёт", () => {
  const result = runFlow(
    transportModule,
    transportInput({}, { insuranceConfirmed: ev(false, "Полис страхования", "не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("transport: срок оказания услуг позже требуемого — отчёт", () => {
  const result = runFlow(transportModule, transportInput({ serviceOfferedDate: "2027-02-01" }));

  assert.equal(result.outcome, "report");
});
