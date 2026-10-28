import assert from "node:assert/strict";
import { test } from "node:test";

import { validMedicalInput, validMedicineInput } from "../../../lib/core/modules/medical/fixtures.ts";
import { validOfficeInput } from "../../../lib/core/modules/office-equipment/fixtures.ts";
import { createDisabledRegistry } from "./disabled.ts";
import { enrichCoreInput } from "./enrich.ts";
import { createStaticRegistry } from "./static.ts";

const deviceRecord = {
  registrationNumber: "РУ № ФСЗ 2026/12345",
  status: "active" as const,
  model: "Модель-1",
  manufacturer: "Пример",
  source: "static",
};

const medicineRecord = {
  registrationNumber: "ЛП-№(000123)-(РГ-RU) 2026",
  status: "active" as const,
  name: "Пример препарата",
  form: "таблетки",
  dosage: "10 мг",
  manufacturer: "Пример",
  source: "static",
};

test("enrich: подставляет запись реестра медизделия, если её нет во входе", async () => {
  const input = { ...validMedicalInput, data: { ...validMedicalInput.data } };
  delete input.data.registryRecord;
  const enriched = await enrichCoreInput(
    input,
    createStaticRegistry({ devices: { "РУ № ФСЗ 2026/12345": deviceRecord } }),
    "medical",
  );

  assert.deepEqual(enriched.data.registryRecord, deviceRecord);
  assert.equal(input.data.registryRecord, undefined);
});

test("enrich: подставляет запись РУ лекарства, если её нет во входе", async () => {
  const input = { ...validMedicineInput, data: { ...validMedicineInput.data } };
  delete input.data.medicineRegistrationRecord;
  const enriched = await enrichCoreInput(
    input,
    createStaticRegistry({ medicines: { "ЛП-№(000123)-(РГ-RU) 2026": medicineRecord } }),
    "medical",
  );

  assert.deepEqual(enriched.data.medicineRegistrationRecord, medicineRecord);
});

test("enrich: не перезаписывает уже переданную запись реестра", async () => {
  const enriched = await enrichCoreInput(
    validMedicalInput,
    createStaticRegistry({ devices: { "РУ № ФСЗ 2026/12345": { ...deviceRecord, model: "Другая модель" } } }),
    "medical",
  );

  assert.equal(enriched, validMedicalInput);
});

test("enrich: отключённый реестр оставляет вход без изменений", async () => {
  const input = { ...validMedicalInput, data: { ...validMedicalInput.data } };
  delete input.data.registryRecord;
  const enriched = await enrichCoreInput(input, createDisabledRegistry(), "medical");

  assert.deepEqual(enriched, input);
});

test("enrich: другие модули не обогащаются", async () => {
  const enriched = await enrichCoreInput(validOfficeInput, createStaticRegistry(), "office-equipment");

  assert.equal(enriched, validOfficeInput);
});
