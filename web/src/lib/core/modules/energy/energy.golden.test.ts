import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { energyInput, ev, validEnergyInput } from "./fixtures.ts";
import { energyModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("energy: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(energyModule), []);
});

test("energy: полный комплект готовит заявку", () => {
  const result = runFlow(energyModule, validEnergyInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("energy: 223-ФЗ не поддерживается", () => {
  const result = runFlow(energyModule, energyInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("energy: другая услуга не проходит модуль", () => {
  const result = runFlow(energyModule, energyInput({ serviceKind: "utilities" }));

  assert.equal(result.outcome, "report");
});

test("energy: без регистрации участника нужен ввод", () => {
  const result = runFlow(energyModule, energyInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("energy: требования к ресурсу не совпали — не участвовать", () => {
  const result = runFlow(
    energyModule,
    energyInput({
      offeredServiceCharacteristics: [
        { name: "Ресурс", value: "Газ" },
        { name: "Мощность", value: 120, unit: "кВт" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("energy: без лицензии нужен ввод", () => {
  const result = runFlow(energyModule, energyInput({}, { licenseConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "licenseConfirmed"), true);
});

test("energy: лицензия не подтверждена — не участвовать", () => {
  const result = runFlow(
    energyModule,
    energyInput({}, { licenseConfirmed: ev(false, "Лицензия", "отсутствует") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("energy: тариф не подтверждён — отчёт", () => {
  const result = runFlow(
    energyModule,
    energyInput({}, { tariffConfirmed: ev(false, "Тарифное решение", "не подтверждено") }),
  );

  assert.equal(result.outcome, "report");
});

test("energy: без документов присоединения нужен ввод", () => {
  const result = runFlow(energyModule, energyInput({}, { connectionConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "connectionConfirmed"), true);
});

test("energy: присоединение не подтверждено — отчёт", () => {
  const result = runFlow(
    energyModule,
    energyInput({}, { connectionConfirmed: ev(false, "Документы присоединения", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("energy: срок оказания услуг позже требуемого — отчёт", () => {
  const result = runFlow(energyModule, energyInput({ serviceOfferedDate: "2027-01-20" }));

  assert.equal(result.outcome, "report");
});
