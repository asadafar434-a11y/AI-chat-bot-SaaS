import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, realEstateInput, validRealEstateInput } from "./fixtures.ts";
import { realEstateModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("real-estate: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(realEstateModule), []);
});

test("real-estate: полный комплект готовит заявку", () => {
  const result = runFlow(realEstateModule, validRealEstateInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("real-estate: 223-ФЗ не поддерживается", () => {
  const result = runFlow(realEstateModule, realEstateInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("real-estate: другая услуга не проходит модуль", () => {
  const result = runFlow(realEstateModule, realEstateInput({ serviceKind: "construction" }));

  assert.equal(result.outcome, "report");
});

test("real-estate: без регистрации участника нужен ввод", () => {
  const result = runFlow(realEstateModule, realEstateInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("real-estate: требования к объекту не совпали — не участвовать", () => {
  const result = runFlow(
    realEstateModule,
    realEstateInput({
      offeredServiceCharacteristics: [
        { name: "Тип объекта", value: "Жилое помещение" },
        { name: "Площадь", value: 550, unit: "м²" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("real-estate: без выписки ЕГРН нужен ввод", () => {
  const result = runFlow(realEstateModule, realEstateInput({}, { legalStatusConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "legalStatusConfirmed"), true);
});

test("real-estate: правовой статус не подтверждён — не участвовать", () => {
  const result = runFlow(
    realEstateModule,
    realEstateInput({}, { legalStatusConfirmed: ev(false, "Выписка ЕГРН", "найден арест") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("real-estate: кадастровый учёт не подтверждён — отчёт", () => {
  const result = runFlow(
    realEstateModule,
    realEstateInput({}, { cadastreConfirmed: ev(false, "Кадастровые документы", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("real-estate: без технического заключения нужен ввод", () => {
  const result = runFlow(realEstateModule, realEstateInput({}, { technicalConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "technicalConfirmed"), true);
});

test("real-estate: техническое состояние не подтверждено — отчёт", () => {
  const result = runFlow(
    realEstateModule,
    realEstateInput({}, { technicalConfirmed: ev(false, "Техническое заключение", "не подтверждено") }),
  );

  assert.equal(result.outcome, "report");
});

test("real-estate: срок сделки позже требуемого — отчёт", () => {
  const result = runFlow(realEstateModule, realEstateInput({ serviceOfferedDate: "2027-06-15" }));

  assert.equal(result.outcome, "report");
});
