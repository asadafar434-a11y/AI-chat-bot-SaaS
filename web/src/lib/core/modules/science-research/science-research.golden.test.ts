import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, scienceResearchInput, validScienceResearchInput } from "./fixtures.ts";
import { scienceResearchModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("science-research: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(scienceResearchModule), []);
});

test("science-research: полный комплект готовит заявку", () => {
  const result = runFlow(scienceResearchModule, validScienceResearchInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("science-research: 223-ФЗ не поддерживается", () => {
  const result = runFlow(scienceResearchModule, scienceResearchInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("science-research: другая услуга не проходит модуль", () => {
  const result = runFlow(scienceResearchModule, scienceResearchInput({ serviceKind: "it_communications" }));

  assert.equal(result.outcome, "report");
});

test("science-research: без регистрации участника нужен ввод", () => {
  const result = runFlow(
    scienceResearchModule,
    scienceResearchInput({}, { participantRegistration: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("science-research: требования к работам не совпали — не участвовать", () => {
  const result = runFlow(
    scienceResearchModule,
    scienceResearchInput({
      offeredServiceCharacteristics: [
        { name: "Тема", value: "Другой материал" },
        { name: "Этапы", value: 3, unit: "этапов" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("science-research: без квалификации нужен ввод", () => {
  const result = runFlow(
    scienceResearchModule,
    scienceResearchInput({}, { qualificationConfirmed: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "qualificationConfirmed"), true);
});

test("science-research: квалификация не подтверждена — отчёт", () => {
  const result = runFlow(
    scienceResearchModule,
    scienceResearchInput({}, { qualificationConfirmed: ev(false, "Документы о квалификации", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("science-research: методика не подтверждена — отчёт", () => {
  const result = runFlow(
    scienceResearchModule,
    scienceResearchInput({}, { methodologyConfirmed: ev(false, "Методика и программа", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("science-research: без соглашения о правах нужен ввод", () => {
  const result = runFlow(scienceResearchModule, scienceResearchInput({}, { ipConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "ipConfirmed"), true);
});

test("science-research: права на результаты не подтверждены — отчёт", () => {
  const result = runFlow(
    scienceResearchModule,
    scienceResearchInput({}, { ipConfirmed: ev(false, "Соглашение о правах", "не подтверждено") }),
  );

  assert.equal(result.outcome, "report");
});

test("science-research: срок работ позже требуемого — отчёт", () => {
  const result = runFlow(scienceResearchModule, scienceResearchInput({ serviceOfferedDate: "2027-12-15" }));

  assert.equal(result.outcome, "report");
});
