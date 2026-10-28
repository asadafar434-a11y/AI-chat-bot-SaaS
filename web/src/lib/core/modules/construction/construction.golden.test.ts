import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { constructionInput, ev, validConstructionInput } from "./fixtures.ts";
import { constructionModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("construction: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(constructionModule), []);
});

test("construction: полный комплект готовит заявку", () => {
  const result = runFlow(constructionModule, validConstructionInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("construction: 223-ФЗ не поддерживается", () => {
  const result = runFlow(constructionModule, constructionInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("construction: другая услуга не проходит модуль", () => {
  const result = runFlow(constructionModule, constructionInput({ serviceKind: "energy" }));

  assert.equal(result.outcome, "report");
});

test("construction: без регистрации участника нужен ввод", () => {
  const result = runFlow(constructionModule, constructionInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("construction: требования к работам не совпали — не участвовать", () => {
  const result = runFlow(
    constructionModule,
    constructionInput({
      offeredServiceCharacteristics: [
        { name: "Вид работ", value: "Текущий ремонт" },
        { name: "Площадь", value: 1_200, unit: "м²" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("construction: без членства в СРО нужен ввод", () => {
  const result = runFlow(constructionModule, constructionInput({}, { sroConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "sroConfirmed"), true);
});

test("construction: членство в СРО не подтверждено — не участвовать", () => {
  const result = runFlow(
    constructionModule,
    constructionInput({}, { sroConfirmed: ev(false, "Свидетельство СРО", "отсутствует") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("construction: разрешения не подтверждены — отчёт", () => {
  const result = runFlow(
    constructionModule,
    constructionInput({}, { permitsConfirmed: ev(false, "Разрешения", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("construction: без плана безопасности нужен ввод", () => {
  const result = runFlow(constructionModule, constructionInput({}, { safetyConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "safetyConfirmed"), true);
});

test("construction: план безопасности не подтверждён — отчёт", () => {
  const result = runFlow(
    constructionModule,
    constructionInput({}, { safetyConfirmed: ev(false, "План безопасности", "не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("construction: срок работ позже требуемого — отчёт", () => {
  const result = runFlow(constructionModule, constructionInput({ serviceOfferedDate: "2027-03-15" }));

  assert.equal(result.outcome, "report");
});
