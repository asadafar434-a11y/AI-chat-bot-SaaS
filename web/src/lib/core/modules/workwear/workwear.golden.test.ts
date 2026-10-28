import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, validWorkwearInput, workwearInput } from "./fixtures.ts";
import { workwearModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("workwear: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(workwearModule), []);
});

test("workwear: полный комплект готовит заявку", () => {
  const result = runFlow(workwearModule, validWorkwearInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("workwear: 223-ФЗ не поддерживается", () => {
  const result = runFlow(workwearModule, workwearInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("workwear: другой объект закупки не проходит модуль", () => {
  const result = runFlow(workwearModule, workwearInput({ productKind: "office_equipment" }));

  assert.equal(result.outcome, "report");
});

test("workwear: без регистрации участника нужен ввод", () => {
  const result = runFlow(workwearModule, workwearInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("workwear: характеристики не совпали — не участвовать", () => {
  const result = runFlow(
    workwearModule,
    workwearInput({
      productCharacteristics: [
        { name: "Материал", value: "Полиэстер" },
        { name: "Класс защиты", value: "2" },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("workwear: без подтверждения соответствия нужен ввод", () => {
  const result = runFlow(workwearModule, workwearInput({}, { conformityDocument: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "conformityDocument"), true);
});

test("workwear: несоответствие ТР ТС — не участвовать", () => {
  const result = runFlow(
    workwearModule,
    workwearInput({}, { conformityDocument: ev(false, "Сертификат соответствия", "не найден") }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("workwear: размерный ряд не покрывает потребность — отчёт", () => {
  const result = runFlow(
    workwearModule,
    workwearInput({}, { sizeRangeCovered: ev(false, "Таблица размеров", "нет нужных размеров") }),
  );

  assert.equal(result.outcome, "report");
});

test("workwear: маркировка не подтверждена — отчёт", () => {
  const result = runFlow(
    workwearModule,
    workwearInput({}, { labelingConfirmed: ev(false, "Подтверждение маркировки", "не подтверждено") }),
  );

  assert.equal(result.outcome, "report");
});

test("workwear: поставка позже срока — отчёт", () => {
  const result = runFlow(workwearModule, workwearInput({ deliveryOfferedDate: "2026-12-25" }));

  assert.equal(result.outcome, "report");
});
