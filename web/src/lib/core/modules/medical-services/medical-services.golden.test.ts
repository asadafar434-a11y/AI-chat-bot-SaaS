import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, medicalServicesInput, validMedicalServicesInput } from "./fixtures.ts";
import { medicalServicesModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("medical-services: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(medicalServicesModule), []);
});

test("medical-services: полный комплект готовит заявку", () => {
  const result = runFlow(medicalServicesModule, validMedicalServicesInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("medical-services: 223-ФЗ не поддерживается", () => {
  const result = runFlow(medicalServicesModule, medicalServicesInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("medical-services: другая услуга не проходит модуль", () => {
  const result = runFlow(medicalServicesModule, medicalServicesInput({ serviceKind: "insurance" }));

  assert.equal(result.outcome, "report");
});

test("medical-services: без регистрации участника нужен ввод", () => {
  const result = runFlow(
    medicalServicesModule,
    medicalServicesInput({}, { participantRegistration: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("medical-services: требования к услуге не совпали — не участвовать", () => {
  const result = runFlow(
    medicalServicesModule,
    medicalServicesInput({
      offeredServiceCharacteristics: [
        { name: "Вид услуги", value: "Вакцинация" },
        { name: "Срок", value: 12, unit: "месяцев" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("medical-services: без лицензии нужен ввод", () => {
  const result = runFlow(medicalServicesModule, medicalServicesInput({}, { licenseConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "licenseConfirmed"), true);
});

test("medical-services: лицензия не подтверждена — не участвовать", () => {
  const result = runFlow(
    medicalServicesModule,
    medicalServicesInput({}, { licenseConfirmed: ev(false, "Лицензия", "отсутствует") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("medical-services: квалификация персонала не подтверждена — отчёт", () => {
  const result = runFlow(
    medicalServicesModule,
    medicalServicesInput({}, { staffConfirmed: ev(false, "Документы персонала", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("medical-services: без СЭЗ нужен ввод", () => {
  const result = runFlow(
    medicalServicesModule,
    medicalServicesInput({}, { sanitaryConfirmed: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "sanitaryConfirmed"), true);
});

test("medical-services: СЭЗ не подтверждено — отчёт", () => {
  const result = runFlow(
    medicalServicesModule,
    medicalServicesInput({}, { sanitaryConfirmed: ev(false, "СЭЗ", "не подтверждено") }),
  );

  assert.equal(result.outcome, "report");
});

test("medical-services: срок оказания услуг позже требуемого — отчёт", () => {
  const result = runFlow(
    medicalServicesModule,
    medicalServicesInput({ serviceOfferedDate: "2027-02-01" }),
  );

  assert.equal(result.outcome, "report");
});
