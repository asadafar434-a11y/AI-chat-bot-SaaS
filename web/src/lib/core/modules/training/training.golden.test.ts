import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, trainingInput, validTrainingInput } from "./fixtures.ts";
import { trainingModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("training: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(trainingModule), []);
});

test("training: полный комплект готовит заявку", () => {
  const result = runFlow(trainingModule, validTrainingInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("training: 223-ФЗ не поддерживается", () => {
  const result = runFlow(trainingModule, trainingInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("training: другая услуга не проходит модуль", () => {
  const result = runFlow(trainingModule, trainingInput({ serviceKind: "events" }));

  assert.equal(result.outcome, "report");
});

test("training: без регистрации участника нужен ввод", () => {
  const result = runFlow(trainingModule, trainingInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("training: требования к услуге не совпали — не участвовать", () => {
  const result = runFlow(
    trainingModule,
    trainingInput({
      offeredServiceCharacteristics: [
        { name: "Программа", value: "Пожарная безопасность" },
        { name: "Объём", value: 40, unit: "часов" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("training: без лицензии нужен ввод", () => {
  const result = runFlow(trainingModule, trainingInput({}, { licenseConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "licenseConfirmed"), true);
});

test("training: лицензия не подтверждена — не участвовать", () => {
  const result = runFlow(
    trainingModule,
    trainingInput({}, { licenseConfirmed: ev(false, "Лицензия", "отсутствует") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("training: программа не подтверждена — отчёт", () => {
  const result = runFlow(
    trainingModule,
    trainingInput({}, { programConfirmed: ev(false, "Программа обучения", "не подтверждена") }),
  );

  assert.equal(result.outcome, "report");
});

test("training: без документов преподавателей нужен ввод", () => {
  const result = runFlow(trainingModule, trainingInput({}, { teachersConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "teachersConfirmed"), true);
});

test("training: квалификация преподавателей не подтверждена — отчёт", () => {
  const result = runFlow(
    trainingModule,
    trainingInput({}, { teachersConfirmed: ev(false, "Документы преподавателей", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("training: срок оказания услуг позже требуемого — отчёт", () => {
  const result = runFlow(trainingModule, trainingInput({ serviceOfferedDate: "2026-12-25" }));

  assert.equal(result.outcome, "report");
});
