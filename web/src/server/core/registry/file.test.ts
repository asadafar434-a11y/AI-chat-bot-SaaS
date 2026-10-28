import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkMedicineRegistrationRecord } from "../../../lib/core/modules/medical/medicine-registration.ts";
import { checkRegistryRecord } from "../../../lib/core/modules/medical/registry.ts";
import { createFileRegistry } from "./file.ts";

const device = {
  registrationNumber: "РЗН 2024/12345",
  status: "active" as const,
  model: "Model X",
  manufacturer: "ООО Производитель",
  source: "file",
};

const medicine = {
  registrationNumber: "ЛП-000001",
  status: "active" as const,
  name: "Препарат",
  form: "таблетки",
  dosage: "10 мг",
  manufacturer: "ООО Фарма",
  source: "file",
};

const withTempFile = async (content: string): Promise<{ dir: string; path: string }> => {
  const dir = await mkdtemp(join(tmpdir(), "core-registry-"));
  const path = join(dir, "registry.json");
  await writeFile(path, content, "utf8");
  return { dir, path };
};

test("file: загружает локальный снимок реестра и подтверждает записи", async () => {
  const { dir, path } = await withTempFile(JSON.stringify({ devices: [device], medicines: [medicine] }));

  try {
    const ports = await createFileRegistry(path);
    const deviceRecord = await ports.devices.lookup({ registrationNumber: "рзн 2024/12345" });
    const medicineRecord = await ports.medicines.lookup({ registrationNumber: "лп-000001" });

    assert.equal(
      checkRegistryRecord(deviceRecord, {
        registrationNumber: "РЗН 2024/12345",
        model: "Model X",
        manufacturer: "ООО Производитель",
      }).matched,
      true,
    );
    assert.equal(
      checkMedicineRegistrationRecord(medicineRecord, {
        registrationNumber: "ЛП-000001",
        name: "Препарат",
        form: "таблетки",
        dosage: "10 мг",
        manufacturer: "ООО Фарма",
      }).matched,
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file: отсутствующий файл отклоняется", async () => {
  await assert.rejects(
    () => createFileRegistry(join(tmpdir(), `core-registry-missing-${Date.now()}.json`)),
    /файл реестра не найден/,
  );
});

test("file: дубликат registrationNumber отклоняется", async () => {
  const { dir, path } = await withTempFile(
    JSON.stringify({ devices: [device, { ...device, model: "Другая модель" }] }),
  );

  try {
    await assert.rejects(() => createFileRegistry(path), /дубликат/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
