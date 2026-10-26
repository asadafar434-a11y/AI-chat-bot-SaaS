import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { officeInput, validOfficeInput } from "./fixtures.ts";
import { officeModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("office: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(officeModule), []);
});

test("office: полный комплект готовит заявку", () => {
  const result = runFlow(officeModule, validOfficeInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("office: 223-ФЗ не поддерживается", () => {
  const result = runFlow(officeModule, officeInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("office: другой объект закупки не проходит модуль", () => {
  const result = runFlow(officeModule, officeInput({ productKind: "medical_device" }));

  assert.equal(result.outcome, "report");
});

test("office: без регистрации участника нужен ввод", () => {
  const result = runFlow(officeModule, officeInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("office: характеристики не совпали — не участвовать", () => {
  const result = runFlow(
    officeModule,
    officeInput({
      productCharacteristics: [
        { name: "Память", value: 8, unit: "ГБ" },
        { name: "Формат", value: "A4" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("office: гарантия не подтверждена — не готовит заявку", () => {
  const result = runFlow(officeModule, officeInput({}, { warrantyIncluded: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "warrantyIncluded"), true);
});

test("office: поставка позже срока — отчёт", () => {
  const result = runFlow(officeModule, officeInput({ deliveryOfferedDate: "2026-12-15" }));

  assert.equal(result.outcome, "report");
});

test("office: обеспечение заявки меньше требуемого — отчёт", () => {
  const result = runFlow(officeModule, officeInput({ applicationSecurityAmount: 3_000 }));

  assert.equal(result.outcome, "report");
});

test("office: отрицательная маржа — отчёт", () => {
  const result = runFlow(officeModule, officeInput({ offerPrice: 305_000 }));

  assert.equal(result.outcome, "report");
});

test("office: антидемпинг без последствия — нужен ввод", () => {
  const result = runFlow(officeModule, officeInput({ offerPrice: 350_000 }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "antidumpingConsequence"), true);
});
