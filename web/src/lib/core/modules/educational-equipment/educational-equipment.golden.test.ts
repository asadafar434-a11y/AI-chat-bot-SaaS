import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { educationalEquipmentInput, ev, validEducationalEquipmentInput } from "./fixtures.ts";
import { educationalEquipmentModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("educational-equipment: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(educationalEquipmentModule), []);
});

test("educational-equipment: полный комплект готовит заявку", () => {
  const result = runFlow(educationalEquipmentModule, validEducationalEquipmentInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("educational-equipment: 223-ФЗ не поддерживается", () => {
  const result = runFlow(educationalEquipmentModule, educationalEquipmentInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("educational-equipment: другой объект закупки не проходит модуль", () => {
  const result = runFlow(educationalEquipmentModule, educationalEquipmentInput({ productKind: "office_equipment" }));

  assert.equal(result.outcome, "report");
});

test("educational-equipment: без регистрации участника нужен ввод", () => {
  const result = runFlow(
    educationalEquipmentModule,
    educationalEquipmentInput({}, { participantRegistration: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("educational-equipment: характеристики не совпали — не участвовать", () => {
  const result = runFlow(
    educationalEquipmentModule,
    educationalEquipmentInput({
      productCharacteristics: [
        { name: "Тип", value: "Проектор" },
        { name: "Диагональ", value: 75, unit: "дюйм" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("educational-equipment: без сертификата нужен ввод", () => {
  const result = runFlow(
    educationalEquipmentModule,
    educationalEquipmentInput({}, { conformityDocument: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "conformityDocument"), true);
});

test("educational-equipment: соответствие не подтверждено — не участвовать", () => {
  const result = runFlow(
    educationalEquipmentModule,
    educationalEquipmentInput({}, { conformityDocument: ev(false, "Сертификат", "не найден") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("educational-equipment: без СЭЗ нужен ввод", () => {
  const result = runFlow(
    educationalEquipmentModule,
    educationalEquipmentInput({}, { sanitaryConclusion: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "sanitaryConclusion"), true);
});

test("educational-equipment: СЭЗ не подтверждено — отчёт", () => {
  const result = runFlow(
    educationalEquipmentModule,
    educationalEquipmentInput({}, { sanitaryConclusion: ev(false, "СЭЗ", "не подтверждено") }),
  );

  assert.equal(result.outcome, "report");
});

test("educational-equipment: поставка позже срока — отчёт", () => {
  const result = runFlow(
    educationalEquipmentModule,
    educationalEquipmentInput({ deliveryOfferedDate: "2026-12-25" }),
  );

  assert.equal(result.outcome, "report");
});

test("educational-equipment: отрицательная маржа — отчёт", () => {
  const result = runFlow(educationalEquipmentModule, educationalEquipmentInput({ offerPrice: 620_000 }));

  assert.equal(result.outcome, "report");
});
