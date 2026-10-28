import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { medicalModule } from "./flow.ts";
import { ev, medicineInput, validMedicineInput } from "./fixtures.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

const registrationRecord = {
  registrationNumber: "ЛП-№(000123)-(РГ-RU) 2026",
  status: "active",
  name: "Пример препарата",
  form: "таблетки",
  dosage: "10 мг",
  manufacturer: "Пример",
  source: "Реестр лекарственных средств",
  checkedAt: "2026-10-26",
};

test("golden: полный комплект лекарства 44-ФЗ готовит заявку", () => {
  const result = runFlow(medicalModule, validMedicineInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
});

test("golden: без РУ лекарства не готовит заявку", () => {
  const result = runFlow(
    medicalModule,
    medicineInput({ medicineRegistrationRecord: null }, { medicineRegistration: null })
  );

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "medicineRegistration"), true);
});

test("golden: РУ не покрывает препарат — не участвовать", () => {
  const result = runFlow(
    medicalModule,
    medicineInput(
      { medicineRegistrationRecord: null },
      { medicineRegistrationMatches: ev(false, "РУ лекарственного препарата", "Форма не совпадает") }
    )
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: РУ лекарства не найдено в реестре — не участвовать", () => {
  const result = runFlow(
    medicalModule,
    medicineInput({ medicineRegistrationRecord: { ...registrationRecord, status: "not_found" } })
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: РУ лекарства просрочено — не участвовать", () => {
  const result = runFlow(
    medicalModule,
    medicineInput({ medicineRegistrationRecord: { ...registrationRecord, status: "expired" } })
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: РУ не подтверждает форму препарата — не участвовать", () => {
  const result = runFlow(
    medicalModule,
    medicineInput({ medicineRegistrationRecord: { ...registrationRecord, form: "капсулы" } })
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: битая запись РУ лекарства — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicineInput({ medicineRegistrationRecord: {} }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "medicineRegistrationRecord"), true);
});

test("golden: характеристики препарата не совпали — не участвовать", () => {
  const result = runFlow(
    medicalModule,
    medicineInput({
      productCharacteristics: [
        { name: "Масса", value: 12, unit: "кг" },
        { name: "Режим работы", value: "непрерывный" },
      ],
    })
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: цена ЖНВЛП выше предельной — отчёт", () => {
  const result = runFlow(
    medicalModule,
    medicineInput({}, { zhvnlpMaxPrice: ev(850_000, "Реестр ЖНВЛП", "Предельная цена 850 000") })
  );

  assert.equal(result.outcome, "report");
});

test("golden: нет подтверждения предельной цены ЖНВЛП — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicineInput({}, { zhvnlpMaxPrice: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "zhvnlpMaxPrice"), true);
});

test("golden: ставка НДС не совпадает — отчёт", () => {
  const result = runFlow(medicalModule, medicineInput({ vatRate: 20 }));

  assert.equal(result.outcome, "report");
});

test("golden: нет подтверждения ставки НДС — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicineInput({}, { vatRateExpected: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "vatRateExpected"), true);
});

test("golden: регистрация цены не подтверждена — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicineInput({}, { priceRegistrationConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "priceRegistrationConfirmed"), true);
});

test("golden: предельная цена не зарегистрирована — отчёт", () => {
  const result = runFlow(
    medicalModule,
    medicineInput({}, { priceRegistrationConfirmed: ev(false, "Реестр цен", "Записи нет") })
  );

  assert.equal(result.outcome, "report");
});

test("golden: оптовая надбавка выше предельной — отчёт", () => {
  const result = runFlow(medicalModule, medicineInput({ wholesaleMarkupPercent: 20 }));

  assert.equal(result.outcome, "report");
});

test("golden: нет подтверждения предельной надбавки — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicineInput({}, { maxWholesaleMarkupPercent: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "maxWholesaleMarkupPercent"), true);
});

test("golden: нет фактической оптовой надбавки — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicineInput({ wholesaleMarkupPercent: undefined }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "wholesaleMarkupPercent"), true);
});

test("golden: предельная надбавка не применяется — готовит заявку", () => {
  const result = runFlow(medicalModule, medicineInput({ markupLimitApplies: false }));

  assert.equal(result.outcome, "prepare_application");
});

test("golden: остаточный срок годности меньше требуемого — отчёт", () => {
  const result = runFlow(medicalModule, medicineInput({ shelfLifeMonths: 6 }));

  assert.equal(result.outcome, "report");
});

test("golden: холодовая цепь не подтверждена — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicineInput({}, { coldChainConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "coldChainConfirmed"), true);
});

test("golden: маркировка не подтверждена — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicineInput({}, { markingConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "markingConfirmed"), true);
});

test("golden: лицензия на фармацевтическую деятельность не подтверждена — отчёт", () => {
  const result = runFlow(
    medicalModule,
    medicineInput({}, { pharmacyLicense: ev(false, "Лицензия", "Лицензия не действует") })
  );

  assert.equal(result.outcome, "report");
});

test("golden: 223-ФЗ не проходит модуль лекарств", () => {
  const result = runFlow(medicalModule, medicineInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});
