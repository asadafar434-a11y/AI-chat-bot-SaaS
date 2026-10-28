import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { designSurveysInput, ev, validDesignSurveysInput } from "./fixtures.ts";
import { designSurveysModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("design-surveys: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(designSurveysModule), []);
});

test("design-surveys: полный комплект готовит заявку", () => {
  const result = runFlow(designSurveysModule, validDesignSurveysInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("design-surveys: 223-ФЗ не поддерживается", () => {
  const result = runFlow(designSurveysModule, designSurveysInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("design-surveys: другая услуга не проходит модуль", () => {
  const result = runFlow(designSurveysModule, designSurveysInput({ serviceKind: "construction" }));

  assert.equal(result.outcome, "report");
});

test("design-surveys: без регистрации участника нужен ввод", () => {
  const result = runFlow(
    designSurveysModule,
    designSurveysInput({}, { participantRegistration: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("design-surveys: требования к работам не совпали — не участвовать", () => {
  const result = runFlow(
    designSurveysModule,
    designSurveysInput({
      offeredServiceCharacteristics: [
        { name: "Вид работ", value: "Изыскания" },
        { name: "Площадь", value: 5_500, unit: "м²" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("design-surveys: без членства в СРО нужен ввод", () => {
  const result = runFlow(designSurveysModule, designSurveysInput({}, { sroConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "sroConfirmed"), true);
});

test("design-surveys: членство в СРО не подтверждено — не участвовать", () => {
  const result = runFlow(
    designSurveysModule,
    designSurveysInput({}, { sroConfirmed: ev(false, "Свидетельство СРО", "отсутствует") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("design-surveys: опыт проектов не подтверждён — отчёт", () => {
  const result = runFlow(
    designSurveysModule,
    designSurveysInput({}, { projectExperienceConfirmed: ev(false, "Портфолио проектов", "не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("design-surveys: без согласований нужен ввод", () => {
  const result = runFlow(designSurveysModule, designSurveysInput({}, { approvalsConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "approvalsConfirmed"), true);
});

test("design-surveys: согласования не подтверждены — отчёт", () => {
  const result = runFlow(
    designSurveysModule,
    designSurveysInput({}, { approvalsConfirmed: ev(false, "Согласования", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("design-surveys: срок работ позже требуемого — отчёт", () => {
  const result = runFlow(designSurveysModule, designSurveysInput({ serviceOfferedDate: "2027-06-15" }));

  assert.equal(result.outcome, "report");
});
