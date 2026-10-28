import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { defenseOrderInput, ev, validDefenseOrderInput } from "./fixtures.ts";
import { defenseOrderModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("defense-order: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(defenseOrderModule), []);
});

test("defense-order: полный комплект готовит заявку", () => {
  const result = runFlow(defenseOrderModule, validDefenseOrderInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("defense-order: 223-ФЗ не поддерживается", () => {
  const result = runFlow(defenseOrderModule, defenseOrderInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("defense-order: другая услуга не проходит модуль", () => {
  const result = runFlow(defenseOrderModule, defenseOrderInput({ serviceKind: "toro" }));

  assert.equal(result.outcome, "report");
});

test("defense-order: без регистрации участника нужен ввод", () => {
  const result = runFlow(defenseOrderModule, defenseOrderInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("defense-order: требования к продукции не совпали — не участвовать", () => {
  const result = runFlow(
    defenseOrderModule,
    defenseOrderInput({
      offeredServiceCharacteristics: [
        { name: "Продукция", value: "Другая продукция" },
        { name: "Количество", value: 100, unit: "шт." },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("defense-order: без лицензии на ГОЗ нужен ввод", () => {
  const result = runFlow(defenseOrderModule, defenseOrderInput({}, { licenseConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "licenseConfirmed"), true);
});

test("defense-order: лицензия на ГОЗ не подтверждена — не участвовать", () => {
  const result = runFlow(
    defenseOrderModule,
    defenseOrderInput({}, { licenseConfirmed: ev(false, "Лицензия на ГОЗ", "отсутствует") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("defense-order: допуск не подтверждён — не участвовать", () => {
  const result = runFlow(
    defenseOrderModule,
    defenseOrderInput({}, { secrecyConfirmed: ev(false, "Допуск", "отсутствует") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("defense-order: без раздельного учёта нужен ввод", () => {
  const result = runFlow(
    defenseOrderModule,
    defenseOrderInput({}, { separateAccountingConfirmed: null }),
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "separateAccountingConfirmed"), true);
});

test("defense-order: раздельный учёт не подтверждён — отчёт", () => {
  const result = runFlow(
    defenseOrderModule,
    defenseOrderInput({}, { separateAccountingConfirmed: ev(false, "Раздельный учёт", "не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("defense-order: срок поставки позже требуемого — отчёт", () => {
  const result = runFlow(defenseOrderModule, defenseOrderInput({ serviceOfferedDate: "2027-06-15" }));

  assert.equal(result.outcome, "report");
});
