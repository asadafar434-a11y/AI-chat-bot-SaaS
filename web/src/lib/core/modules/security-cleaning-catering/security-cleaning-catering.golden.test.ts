import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import {
  ev,
  securityCleaningCateringInput,
  validSecurityCleaningCateringInput,
} from "./fixtures.ts";
import { securityCleaningCateringModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("security-cleaning-catering: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(securityCleaningCateringModule), []);
});

test("security-cleaning-catering: полный комплект готовит заявку", () => {
  const result = runFlow(securityCleaningCateringModule, validSecurityCleaningCateringInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("security-cleaning-catering: 223-ФЗ не поддерживается", () => {
  const result = runFlow(
    securityCleaningCateringModule,
    securityCleaningCateringInput({ law: "223-ФЗ" }),
  );

  assert.equal(result.outcome, "report");
});

test("security-cleaning-catering: другая услуга не проходит модуль", () => {
  const result = runFlow(
    securityCleaningCateringModule,
    securityCleaningCateringInput({ serviceKind: "toro" }),
  );

  assert.equal(result.outcome, "report");
});

test("security-cleaning-catering: без регистрации участника нужен ввод", () => {
  const result = runFlow(
    securityCleaningCateringModule,
    securityCleaningCateringInput({}, { participantRegistration: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("security-cleaning-catering: требования к услуге не совпали — не участвовать", () => {
  const result = runFlow(
    securityCleaningCateringModule,
    securityCleaningCateringInput({
      offeredServiceCharacteristics: [
        { name: "Услуга", value: "Только уборка" },
        { name: "Количество сотрудников", value: 12, unit: "чел." },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("security-cleaning-catering: без лицензии на охрану нужен ввод", () => {
  const result = runFlow(
    securityCleaningCateringModule,
    securityCleaningCateringInput({}, { securityLicenseConfirmed: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "securityLicenseConfirmed"), true);
});

test("security-cleaning-catering: лицензия на охрану не подтверждена — не участвовать", () => {
  const result = runFlow(
    securityCleaningCateringModule,
    securityCleaningCateringInput({}, { securityLicenseConfirmed: ev(false, "Лицензия на охрану", "отсутствует") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("security-cleaning-catering: персонал не подтверждён — отчёт", () => {
  const result = runFlow(
    securityCleaningCateringModule,
    securityCleaningCateringInput({}, { staffConfirmed: ev(false, "Документы персонала", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("security-cleaning-catering: без подтверждения питания нужен ввод", () => {
  const result = runFlow(
    securityCleaningCateringModule,
    securityCleaningCateringInput({}, { foodSafetyConfirmed: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "foodSafetyConfirmed"), true);
});

test("security-cleaning-catering: безопасность питания не подтверждена — отчёт", () => {
  const result = runFlow(
    securityCleaningCateringModule,
    securityCleaningCateringInput({}, { foodSafetyConfirmed: ev(false, "Подтверждение питания", "не подтверждено") }),
  );

  assert.equal(result.outcome, "report");
});

test("security-cleaning-catering: срок услуг позже требуемого — отчёт", () => {
  const result = runFlow(
    securityCleaningCateringModule,
    securityCleaningCateringInput({ serviceOfferedDate: "2027-01-15" }),
  );

  assert.equal(result.outcome, "report");
});
