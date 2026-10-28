import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { validMedicineInput } from "../../../lib/core/modules/medical/fixtures.ts";
import {
  MedicineReferenceNotConfiguredError,
  type MedicineReferenceSnapshot,
} from "../../../lib/core/ports/medicine-reference.ts";
import { createDisabledMedicineReference } from "./disabled.ts";
import { enrichMedicineReference } from "./enrich.ts";
import { createFileMedicineReference } from "./file.ts";
import { createStaticMedicineReference } from "./static.ts";

const snapshot: MedicineReferenceSnapshot = {
  source: "Пример справочника",
  edition: "2026-01",
  effectiveFrom: "2026-01-01",
  complete: true,
};

const item = {
  registrationNumber: "ЛП-№(000123)-(РГ-RU) 2026",
  zhvnlp: true,
  maxPrice: 950_000,
  vatRate: 10,
};

const withoutReference = () => {
  const input = {
    ...validMedicineInput,
    data: { ...validMedicineInput.data },
    evidence: { ...(validMedicineInput.evidence ?? {}) },
  };
  delete input.data.zhvnlpApplies;
  delete input.data.zhvnlpMaxPrice;
  delete input.data.vatRateExpected;
  delete input.evidence.zhvnlpMaxPrice;
  delete input.evidence.vatRateExpected;
  return input;
};

test("reference: static enrichment заполняет ЖНВЛП, предельную цену и НДС", async () => {
  const input = withoutReference();
  const port = createStaticMedicineReference({ snapshot, items: [item] });

  const lookup = await port.lookup(item.registrationNumber);
  const enriched = await enrichMedicineReference(input, port, "medical");

  assert.equal(lookup.item?.zhvnlp, true);
  assert.equal(enriched.data.zhvnlpApplies, true);
  assert.equal((enriched.evidence?.zhvnlpMaxPrice?.value as number), 950_000);
  assert.equal((enriched.evidence?.vatRateExpected?.value as number), 10);
  assert.match(enriched.evidence?.zhvnlpMaxPrice?.source ?? "", /2026-01/);
});

test("reference: complete snapshot без записи выставляет ЖНВЛП=false, incomplete — нет", async () => {
  const input = withoutReference();
  const completePort = createStaticMedicineReference({ snapshot, items: [] });
  const incompletePort = createStaticMedicineReference({
    snapshot: { ...snapshot, complete: false },
    items: [],
  });

  const complete = await enrichMedicineReference(input, completePort, "medical");
  const incomplete = await enrichMedicineReference(input, incompletePort, "medical");

  assert.equal(complete.data.zhvnlpApplies, false);
  assert.equal(Object.prototype.hasOwnProperty.call(incomplete.data, "zhvnlpApplies"), false);
});

test("reference: существующие значения не перезаписываются", async () => {
  const port = createStaticMedicineReference({
    snapshot,
    items: [{ ...item, maxPrice: 1, vatRate: 20 }],
  });

  const enriched = await enrichMedicineReference(validMedicineInput, port, "medical");

  assert.equal(enriched, validMedicineInput);
});

test("reference: disabled adapter оставляет вход без изменений", async () => {
  const input = withoutReference();
  const enriched = await enrichMedicineReference(input, createDisabledMedicineReference(), "medical");

  assert.deepEqual(enriched, input);
});

test("reference: другие модули не обогащаются", async () => {
  const port = createStaticMedicineReference({ snapshot, items: [item] });
  const enriched = await enrichMedicineReference(validMedicineInput, port, "office-equipment");

  assert.equal(enriched, validMedicineInput);
});

test("reference: file adapter загружает снимок, отклоняет дубликаты и отсутствующий файл", async () => {
  const dir = await mkdtemp(join(tmpdir(), "core-reference-"));
  const path = join(dir, "reference.json");
  const content = { ...snapshot, items: [item] };
  await writeFile(path, JSON.stringify(content), "utf8");

  try {
    const port = await createFileMedicineReference(path);
    const lookup = await port.lookup(item.registrationNumber);
    assert.equal(lookup.item?.zhvnlp, true);
    assert.equal(lookup.snapshot.edition, "2026-01");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  await assert.rejects(
    () => createFileMedicineReference(join(tmpdir(), `core-reference-missing-${Date.now()}.json`)),
    /файл справочника не найден/,
  );

  const duplicateDir = await mkdtemp(join(tmpdir(), "core-reference-"));
  const duplicatePath = join(duplicateDir, "reference.json");
  await writeFile(duplicatePath, JSON.stringify({ ...snapshot, items: [item, item] }), "utf8");
  try {
    await assert.rejects(() => createFileMedicineReference(duplicatePath), /дубликат/);
  } finally {
    await rm(duplicateDir, { recursive: true, force: true });
  }
});

test("reference: disabled adapter явно сообщает об ошибке", async () => {
  await assert.rejects(
    () => createDisabledMedicineReference().lookup(item.registrationNumber),
    MedicineReferenceNotConfiguredError,
  );
});
