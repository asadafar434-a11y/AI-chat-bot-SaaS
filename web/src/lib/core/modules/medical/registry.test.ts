import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRegistryRecord } from "./registry.ts";

const record = {
  registrationNumber: "РУ № ФСЗ 2026/12345",
  status: "active",
  model: "Модель-1",
  manufacturer: "Пример",
  source: "Реестр Росздравнадзора",
  checkedAt: "2026-10-26",
};

const expected = {
  registrationNumber: "РУ № ФСЗ 2026/12345",
  model: "Модель-1",
  manufacturer: "Пример",
};

test("registry: активная запись совпадает с РУ, моделью и производителем", () => {
  const result = checkRegistryRecord(record, expected);

  assert.equal(result.matched, true);
  assert.deepEqual(result.reasons, []);
});

test("registry: запись не найдена", () => {
  const result = checkRegistryRecord({ ...record, status: "not_found" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["not_found"]);
});

test("registry: запись просрочена", () => {
  const result = checkRegistryRecord({ ...record, status: "expired" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["expired"]);
});

test("registry: номер РУ не совпадает", () => {
  const result = checkRegistryRecord({ ...record, registrationNumber: "РУ № ФСЗ 2025/00001" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["number"]);
});

test("registry: модель не совпадает", () => {
  const result = checkRegistryRecord({ ...record, model: "Модель-2" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["model"]);
});

test("registry: производитель не совпадает", () => {
  const result = checkRegistryRecord({ ...record, manufacturer: "Другой завод" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["manufacturer"]);
});

test("registry: без модели в записи реестра нельзя подтвердить модель", () => {
  const result = checkRegistryRecord({ ...record, model: undefined }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.reasons, ["model"]);
});

test("registry: битая запись — missing, а не ложное подтверждение", () => {
  const result = checkRegistryRecord({}, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.missing, ["registryRecord"]);
});

test("registry: неизвестный статус — missing", () => {
  const result = checkRegistryRecord({ ...record, status: "unknown" }, expected);

  assert.equal(result.matched, false);
  assert.deepEqual(result.missing, ["registryRecord"]);
});
