import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, insuranceInput, validInsuranceInput } from "./fixtures.ts";
import { insuranceModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("insurance: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(insuranceModule), []);
});

test("insurance: полный комплект готовит заявку", () => {
  const result = runFlow(insuranceModule, validInsuranceInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("insurance: 223-ФЗ не поддерживается", () => {
  const result = runFlow(insuranceModule, insuranceInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("insurance: другая услуга не проходит модуль", () => {
  const result = runFlow(insuranceModule, insuranceInput({ serviceKind: "training" }));

  assert.equal(result.outcome, "report");
});

test("insurance: без регистрации участника нужен ввод", () => {
  const result = runFlow(insuranceModule, insuranceInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("insurance: требования к услуге не совпали — не участвовать", () => {
  const result = runFlow(
    insuranceModule,
    insuranceInput({
      offeredServiceCharacteristics: [
        { name: "Вид страхования", value: "КАСКО" },
        { name: "Срок", value: 12, unit: "месяцев" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("insurance: без лицензии нужен ввод", () => {
  const result = runFlow(insuranceModule, insuranceInput({}, { licenseConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "licenseConfirmed"), true);
});

test("insurance: лицензия не подтверждена — не участвовать", () => {
  const result = runFlow(
    insuranceModule,
    insuranceInput({}, { licenseConfirmed: ev(false, "Лицензия страховщика", "отсутствует") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("insurance: без правил страхования нужен ввод", () => {
  const result = runFlow(insuranceModule, insuranceInput({}, { insuranceRulesConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "insuranceRulesConfirmed"), true);
});

test("insurance: правила страхования не подтверждены — отчёт", () => {
  const result = runFlow(
    insuranceModule,
    insuranceInput({}, { insuranceRulesConfirmed: ev(false, "Правила страхования", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("insurance: перестрахование не подтверждено — отчёт", () => {
  const result = runFlow(
    insuranceModule,
    insuranceInput({}, { reinsuranceConfirmed: ev(false, "Договор перестрахования", "не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("insurance: срок оказания услуг позже требуемого — отчёт", () => {
  const result = runFlow(insuranceModule, insuranceInput({ serviceOfferedDate: "2027-01-10" }));

  assert.equal(result.outcome, "report");
});
