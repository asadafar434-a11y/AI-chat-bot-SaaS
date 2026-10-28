import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { buildingMaterialsInput, ev, validBuildingMaterialsInput } from "./fixtures.ts";
import { buildingMaterialsModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("building-materials: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(buildingMaterialsModule), []);
});

test("building-materials: полный комплект готовит заявку", () => {
  const result = runFlow(buildingMaterialsModule, validBuildingMaterialsInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("building-materials: 223-ФЗ не поддерживается", () => {
  const result = runFlow(buildingMaterialsModule, buildingMaterialsInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("building-materials: другой объект закупки не проходит модуль", () => {
  const result = runFlow(buildingMaterialsModule, buildingMaterialsInput({ productKind: "stationery" }));

  assert.equal(result.outcome, "report");
});

test("building-materials: без регистрации участника нужен ввод", () => {
  const result = runFlow(
    buildingMaterialsModule,
    buildingMaterialsInput({}, { participantRegistration: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("building-materials: характеристики не совпали — не участвовать", () => {
  const result = runFlow(
    buildingMaterialsModule,
    buildingMaterialsInput({
      productCharacteristics: [
        { name: "Марка бетона", value: "M200" },
        { name: "Прочность", value: 35, unit: "МПа" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("building-materials: без сертификата нужен ввод", () => {
  const result = runFlow(buildingMaterialsModule, buildingMaterialsInput({}, { conformityDocument: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "conformityDocument"), true);
});

test("building-materials: соответствие не подтверждено — не участвовать", () => {
  const result = runFlow(
    buildingMaterialsModule,
    buildingMaterialsInput({}, { conformityDocument: ev(false, "Сертификат", "не найден") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("building-materials: без паспорта партии нужен ввод", () => {
  const result = runFlow(buildingMaterialsModule, buildingMaterialsInput({}, { batchPassport: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "batchPassport"), true);
});

test("building-materials: паспорт партии не подтверждён — отчёт", () => {
  const result = runFlow(
    buildingMaterialsModule,
    buildingMaterialsInput({}, { batchPassport: ev(false, "Паспорт партии", "не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("building-materials: поставка позже срока — отчёт", () => {
  const result = runFlow(buildingMaterialsModule, buildingMaterialsInput({ deliveryOfferedDate: "2026-12-25" }));

  assert.equal(result.outcome, "report");
});

test("building-materials: отрицательная маржа — отчёт", () => {
  const result = runFlow(buildingMaterialsModule, buildingMaterialsInput({ offerPrice: 410_000 }));

  assert.equal(result.outcome, "report");
});
