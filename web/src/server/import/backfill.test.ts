/**
 * S11-R0: legacy IndexedDB backfill через существующий механизм переноса S3.
 *
 * Проверяет: содержимое документов/образцов и метаданные профиля доезжают до
 * S6 и PostgreSQL; повторный прогон идемпотентен и не двигает исторические даты;
 * частичное состояние дозаполняется инкрементально; расхождение имени — конфликт
 * без молчаливой перезаписи; чужой tenant ничего не видит.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { withRunner } from "../auth/transaction.ts";
import { createMemoryDb } from "../auth/testing/memory-db.ts";
import type { MemoryDb } from "../auth/testing/memory-db.ts";
import { orgScope } from "../db/org-scope.ts";
import { listDocuments, listSamples, readProfile, type ReadContext } from "../read/services.ts";
import { memoryStorage } from "../storage/testing/memory-storage.ts";
import type { StorageAdapter } from "../storage/types.ts";
import { contentBackupJson, contentConflictBackupJson } from "./testing/fixtures.ts";
import { runLegacyImport, type LegacyImportRun } from "./pipeline.ts";

const ORG_A = "ca00000000000000000001";
const ORG_B = "cb00000000000000000001";
const U1 = "cu10000000000000000001";

function makeMemory(): MemoryDb {
  const memory = createMemoryDb();
  memory.table("membership").push({ organizationId: ORG_A, userId: U1 });
  return memory;
}

function run(memory: MemoryDb, raw: string, storage: StorageAdapter | undefined, batchKey: string): Promise<LegacyImportRun> {
  return runLegacyImport({
    db: memory.db,
    run: withRunner(memory.db),
    scope: orgScope(ORG_A),
    userId: U1,
    raw,
    storage,
    batchKey,
  });
}

async function readAll(memory: MemoryDb, storage: StorageAdapter | undefined): Promise<{ docs: Awaited<ReturnType<typeof listDocuments>>; samples: Awaited<ReturnType<typeof listSamples>>; profile: Awaited<ReturnType<typeof readProfile>> }> {
  const ctx: ReadContext = { db: memory.db, scope: orgScope(ORG_A), userId: U1, storage };
  return { docs: await listDocuments(ctx, "cp1"), samples: await listSamples(ctx), profile: await readProfile(ctx) };
}

test("backfill: text/map документа, MyDocument целиком и ProfileMeta", async () => {
  const memory = makeMemory();
  const storage = memoryStorage();
  const result = await run(memory, contentBackupJson(), storage, "bf-1");
  assert.equal(result.reconciliation.verdict, "match");

  const { docs, samples, profile } = await readAll(memory, storage);
  assert.equal(docs[0].text, "Текст с картой");
  assert.deepEqual(docs[0].map?.spans, [
    { from: 0, to: 4, page: 1 },
    { from: 4, to: 14, table: 1, row: 1, col: 1 },
  ]);
  assert.equal(docs[0].scan, true);

  assert.equal(samples[0].name, "Образец.pdf");
  assert.equal(samples[0].addedAt, "2026-09-03T10:00:00.000Z");
  assert.equal(samples[0].scan, true);
  assert.equal(samples[0].text, "Образец с картой");
  assert.deepEqual(samples[0].map?.spans, [{ from: 0, to: 7, page: 1 }]);

  assert.equal(profile.meta.sources.inn, "ТЗ.pdf");
  assert.deepEqual(profile.meta.suggestions, [{ key: "kpp", value: "1", source: "ТЗ.pdf" }]);
});

test("backfill идемпотентен: повтор не плодит записи и не двигает addedAt", async () => {
  const memory = makeMemory();
  const storage = memoryStorage();
  await run(memory, contentBackupJson(), storage, "bf-2a");
  const sampleRowsBefore = memory.table("sample").length;
  const documentRowsBefore = memory.table("document").length;
  const purchaseRowsBefore = memory.table("purchase").length;

  // Другой хеш (пробел) и другой batchKey: это не «уже импортировано», а повторная запись.
  const again = await run(memory, `${contentBackupJson()} `, storage, "bf-2b");
  assert.equal(again.reconciliation.verdict, "match");
  assert.equal(again.result?.find((r) => r.entity === "samples")?.created, 0);
  assert.equal(memory.table("sample").length, sampleRowsBefore, "дублей образцов нет");
  assert.equal(memory.table("document").length, documentRowsBefore, "дублей документов нет");
  assert.equal(memory.table("purchase").length, purchaseRowsBefore);

  const { samples } = await readAll(memory, storage);
  assert.equal(samples[0].addedAt, "2026-09-03T10:00:00.000Z", "историческая дата не переписана текущей");
});

test("backfill инкрементален: без S6 метаданные, затем дозаполнение содержимого", async () => {
  const memory = makeMemory();

  // Первый прогон без хранилища: имя/дата/скан есть, содержимого нет.
  await run(memory, contentBackupJson(), undefined, "bf-3a");
  const before = await readAll(memory, undefined);
  assert.equal(before.samples[0].name, "Образец.pdf");
  assert.equal(before.samples[0].text, null);
  assert.equal(before.samples[0].textStatus, "missing");
  assert.equal(before.docs[0].textStatus, "missing");

  // Второй прогон с хранилищем: строки те же, но текст и карта дозаполняются.
  const storage = memoryStorage();
  await run(memory, `${contentBackupJson()} `, storage, "bf-3b");
  assert.equal(memory.table("sample").length, 1, "дозаполнение не создало второй образец");
  assert.equal(memory.table("document").length, 1);

  const after = await readAll(memory, storage);
  assert.equal(after.samples[0].text, "Образец с картой");
  assert.equal(after.samples[0].textStatus, "available");
  assert.equal(after.docs[0].text, "Текст с картой");
  assert.equal(after.docs[0].textStatus, "available");
});

test("расхождение имени образца — конфликт без молчаливой перезаписи", async () => {
  const memory = makeMemory();
  const storage = memoryStorage();
  await run(memory, contentBackupJson(), storage, "bf-4a");

  const conflict = await run(memory, contentConflictBackupJson(), storage, "bf-4b");
  assert.equal(conflict.reconciliation.verdict, "mismatch");
  assert.ok(
    conflict.result?.find((r) => r.entity === "samples")?.conflicts.includes("cs1"),
    "конфликт зафиксирован в результате",
  );
  const { samples } = await readAll(memory, storage);
  assert.equal(samples[0].name, "Образец.pdf", "серверное имя не перезаписано");
});

test("tenant isolation: чужая организация не видит backfilled данные", async () => {
  const memory = makeMemory();
  const storage = memoryStorage();
  await run(memory, contentBackupJson(), storage, "bf-5");

  memory.table("membership").push({ organizationId: ORG_B, userId: U1 });
  const foreign: ReadContext = { db: memory.db, scope: orgScope(ORG_B), userId: U1, storage };
  assert.deepEqual(await listSamples(foreign), []);
  assert.deepEqual(await listDocuments(foreign, "cp1"), []);
});
