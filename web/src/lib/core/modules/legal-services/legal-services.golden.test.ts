import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, legalServicesInput, validLegalServicesInput } from "./fixtures.ts";
import { legalServicesModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("legal-services: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(legalServicesModule), []);
});

test("legal-services: полный комплект готовит заявку", () => {
  const result = runFlow(legalServicesModule, validLegalServicesInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("legal-services: 223-ФЗ не поддерживается", () => {
  const result = runFlow(legalServicesModule, legalServicesInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("legal-services: другая услуга не проходит модуль", () => {
  const result = runFlow(legalServicesModule, legalServicesInput({ serviceKind: "insurance" }));

  assert.equal(result.outcome, "report");
});

test("legal-services: без регистрации участника нужен ввод", () => {
  const result = runFlow(
    legalServicesModule,
    legalServicesInput({}, { participantRegistration: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("legal-services: требования к услуге не совпали — не участвовать", () => {
  const result = runFlow(
    legalServicesModule,
    legalServicesInput({
      offeredServiceCharacteristics: [
        { name: "Вид услуги", value: "Бухгалтерский аудит" },
        { name: "Срок", value: 12, unit: "месяцев" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("legal-services: без членства в СРО нужен ввод", () => {
  const result = runFlow(legalServicesModule, legalServicesInput({}, { membershipConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "membershipConfirmed"), true);
});

test("legal-services: членство не подтверждено — не участвовать", () => {
  const result = runFlow(
    legalServicesModule,
    legalServicesInput({}, { membershipConfirmed: ev(false, "Свидетельство СРО", "отсутствует") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("legal-services: отраслевой опыт не подтверждён — отчёт", () => {
  const result = runFlow(
    legalServicesModule,
    legalServicesInput({}, { industryExperienceConfirmed: ev(false, "Реестр контрактов", "опыт не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("legal-services: без декларации конфликта нужен ввод", () => {
  const result = runFlow(
    legalServicesModule,
    legalServicesInput({}, { conflictCheckConfirmed: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "conflictCheckConfirmed"), true);
});

test("legal-services: конфликт интересов не подтверждён — отчёт", () => {
  const result = runFlow(
    legalServicesModule,
    legalServicesInput({}, { conflictCheckConfirmed: ev(false, "Декларация конфликта", "конфликт найден") }),
  );

  assert.equal(result.outcome, "report");
});

test("legal-services: срок оказания услуг позже требуемого — отчёт", () => {
  const result = runFlow(
    legalServicesModule,
    legalServicesInput({ serviceOfferedDate: "2027-01-20" }),
  );

  assert.equal(result.outcome, "report");
});
