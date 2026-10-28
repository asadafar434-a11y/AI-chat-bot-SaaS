import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMedicineRegistrationRecord } from "./medicine-registration.ts";

const record = {
  registrationNumber: "ЛП-№(000123)-(РГ-RU) 2026",
  status: "active",
  name: "Пример препарата",
  form: "таблетки",
  dosage: "10 мг",
  manufacturer: "Пример",
  source: "Реестр лекарственных средств",
  checkedAt: "2026-10-26",
};

const expected = {
  registrationNumber: "ЛП-№(000123)-(РГ-RU) 2026",
  name: "Пример препарата",
  form: "таблетки",
  dosage: "10 мг",
  manufacturer: "Пример",
};

test("medicine registration: активная запись совпадает по всем полям", () => {
  const result = checkMedicineRegistrationRecord(record, expected);

  assert.equal(result.matched, true);
  assert.deepEqual(result.reasons, []);
});

test("medicine registration: запись не найдена", () => {
  const result = checkMedicineRegistrationRecord({ ...record, status: "not_found" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["not_found"]);
});

test("medicine registration: запись просрочена", () => {
  const result = checkMedicineRegistrationRecord({ ...record, status: "expired" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["expired"]);
});

test("medicine registration: номер РУ не совпадает", () => {
  const result = checkMedicineRegistrationRecord({ ...record, registrationNumber: "ЛП-№(000999)" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["number"]);
});

test("medicine registration: название препарата не совпадает", () => {
  const result = checkMedicineRegistrationRecord({ ...record, name: "Другой препарат" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["name"]);
});

test("medicine registration: форма не совпадает", () => {
  const result = checkMedicineRegistrationRecord({ ...record, form: "капсулы" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["form"]);
});

test("medicine registration: дозировка не совпадает", () => {
  const result = checkMedicineRegistrationRecord({ ...record, dosage: "20 мг" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["dosage"]);
});

test("medicine registration: производитель не совпадает", () => {
  const result = checkMedicineRegistrationRecord({ ...record, manufacturer: "Другой завод" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["manufacturer"]);
});

test("medicine registration: битая запись — missing, а не ложное подтверждение", () => {
  const result = checkMedicineRegistrationRecord({}, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.missing, ["medicineRegistrationRecord"]);
});

test("medicine registration: неизвестный статус — missing", () => {
  const result = checkMedicineRegistrationRecord({ ...record, status: "unknown" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.missing, ["medicineRegistrationRecord"]);
});
