/**
 * File services S6: upload/download-url/delete + reconciliation.
 * БД — in-memory, хранилище — fs-бэкенд во временной папке.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { withRunner } from "../auth/transaction.ts";
import { createMemoryDb } from "../auth/testing/memory-db.ts";
import { orgScope } from "../db/org-scope.ts";
import { runLegacyImport } from "../import/pipeline.ts";
import { standardBackupJson } from "../import/testing/fixtures.ts";
import { FsStorageAdapter } from "./fs.ts";
import {
  deleteDocument,
  grantDocumentDownload,
  reconcileFileStorage,
  uploadDocument,
  type FileContext,
} from "./files.ts";

const ORG_A = "ca00000000000000000001";
const ORG_B = "cb00000000000000000001";
const U1 = "cu10000000000000000001";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

async function makeCtx() {
  const memory = createMemoryDb();
  memory.table("membership").push({ organizationId: ORG_A, userId: U1 });
  memory.table("membership").push({ organizationId: ORG_B, userId: U1 });
  const dir = await mkdtemp(join(tmpdir(), "s6-files-"));
  const storage = new FsStorageAdapter({ dir, secret: "test-secret" });
  const db = memory.db;
  const scope = orgScope(ORG_A);
  await runLegacyImport({
    db,
    run: withRunner(db),
    scope,
    userId: U1,
    raw: standardBackupJson(),
    batchKey: `files-${Math.random().toString(36).slice(2)}`,
  });
  const ctx: FileContext = { db, storage, scope, userId: U1 };
  return { memory, dir, storage, ctx };
}

async function drop(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

test("upload: метаданные без ключа наружу, объект на месте, sha проверен", async () => {
  const { ctx, dir, memory, storage } = await makeCtx();
  try {
    const uploaded = await uploadDocument(ctx, {
      purchaseId: "pa",
      fileName: "Договор.pdf",
      mimeType: "application/pdf",
      contentBase64: b64("текст договора"),
      ocr: true,
    });
    assert.equal(typeof uploaded.id, "string");
    assert.ok(!("storageKey" in uploaded), "ключ наружу не возвращается");
    assert.equal(uploaded.sizeBytes, Buffer.byteLength("текст договора", "utf8"));
    assert.equal(uploaded.fileName, "Договор.pdf");

    const rows = memory.table("document") as Record<string, unknown>[];
    const row = rows.find((r) => r.id === uploaded.id) as Record<string, unknown>;
    assert.ok(typeof row.storageKey === "string" && row.storageKey.startsWith(`org/${ORG_A}/doc/`));
    assert.equal(row.purchaseId !== undefined, true);
    const head = await storage.headObject(row.storageKey as string);
    assert.equal(head?.sizeBytes, uploaded.sizeBytes);
    assert.equal(head?.sha256, uploaded.sha256);
  } finally {
    await drop(dir);
  }
});

test("upload отклоняет: чужую закупку, мусор, перевес, несовпавший sha", async () => {
  const { ctx, dir, memory } = await makeCtx();
  try {
    memory.table("purchase").push({
      id: "pg-alien",
      organizationId: ORG_B,
      legacyId: "alien",
      originalFormatVersion: 2,
      status: "draft",
      payload: {},
    });
    const base = { fileName: "Ф.pdf", contentBase64: b64("x") };
    const notFound = /не найдена в пределах организации/;
    await assert.rejects(() => uploadDocument(ctx, { ...base, purchaseId: "alien" }), notFound);
    await assert.rejects(() => uploadDocument(ctx, { ...base, purchaseId: "nope" }), notFound);
    await assert.rejects(() => uploadDocument(ctx, { ...base, purchaseId: "pa", fileName: "" }), /имя файла/);
    await assert.rejects(() => uploadDocument(ctx, { ...base, purchaseId: "pa", contentBase64: "%%%" }), /base64/);
    await assert.rejects(() => uploadDocument(ctx, { ...base, purchaseId: "pa", contentBase64: b64("") }), /пустой/);
    await assert.rejects(
      () => uploadDocument(ctx, { ...base, purchaseId: "pa", sha256: "0".repeat(64) }),
      /не совпал/,
    );
    const before = memory.table("document").length;
    assert.equal(before, 4, "отказы ничего не записали");
  } finally {
    await drop(dir);
  }
});

test("upload ограничивает размер (40 МБ)", { timeout: 120_000 }, async () => {
  const { ctx, dir } = await makeCtx();
  try {
    const big = Buffer.alloc(41 * 1024 * 1024, 1).toString("base64");
    await assert.rejects(
      () => uploadDocument(ctx, { purchaseId: "pa", fileName: "Б.pdf", contentBase64: big }),
      /больше/,
    );
  } finally {
    await drop(dir);
  }
});

test("download grant: ссылка выдаётся, чужая и отсутствующая — одинаковый 404", async () => {
  const { ctx, dir } = await makeCtx();
  try {
    const uploaded = await uploadDocument(ctx, {
      purchaseId: "pa",
      fileName: "Д.pdf",
      contentBase64: b64("секретно"),
    });
    const grant = await grantDocumentDownload(ctx, uploaded.id);
    assert.ok(grant.url.length > 0 && grant.expiresIn > 0);

    const foreign: FileContext = { ...ctx, scope: orgScope(ORG_B) };
    const errors: string[] = [];
    for (const fn of [
      () => grantDocumentDownload(ctx, "nope"),
      () => grantDocumentDownload(foreign, uploaded.id),
    ]) {
      try {
        await fn();
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    assert.equal(errors.length, 2);
    assert.equal(errors[0], errors[1], "чужое и отсутствующее неразличимы");
  } finally {
    await drop(dir);
  }
});

test("delete: объект и строка удаляются; повтор — 404; сирота — явно", async () => {
  const { ctx, dir, memory, storage } = await makeCtx();
  try {
    const uploaded = await uploadDocument(ctx, {
      purchaseId: "pa",
      fileName: "Д.pdf",
      contentBase64: b64("x"),
    });
    const first = await deleteDocument(ctx, uploaded.id);
    assert.deepEqual(first, { ok: true, objectDeleted: true });
    await assert.rejects(() => deleteDocument(ctx, uploaded.id), /не найдена в пределах организации/);

    const second = await uploadDocument(ctx, {
      purchaseId: "pa",
      fileName: "Е.pdf",
      contentBase64: b64("y"),
    });
    const row = (memory.table("document") as Record<string, unknown>[]).find((r) => r.id === second.id);
    assert.ok(row);
    await storage.deleteObject(row?.storageKey as string);
    const orphaned = await deleteDocument(ctx, second.id);
    assert.deepEqual(orphaned, { ok: true, objectDeleted: false }, "ложного успеха нет");
  } finally {
    await drop(dir);
  }
});

test("reconcile: match, сироты, потери, расхождения, кросс-тенант, дубли", async () => {
  const { ctx, dir, memory, storage } = await makeCtx();
  const rowsOf = () => memory.table("document") as Record<string, unknown>[];
  const rowOf = (id: string) => rowsOf().find((r) => r.id === id) as Record<string, unknown>;
  try {
    const a = await uploadDocument(ctx, { purchaseId: "pa", fileName: "А.pdf", contentBase64: b64("данные-а") });
    const b = await uploadDocument(ctx, { purchaseId: "pa", fileName: "Б.pdf", contentBase64: b64("данные-б") });

    const clean = await reconcileFileStorage(ctx);
    assert.equal(clean.match, true, JSON.stringify(clean));
    assert.equal(clean.checked, 2);
    assert.equal(clean.ok, 2);

    // Метаданные без объекта.
    await storage.deleteObject(rowOf(a.id).storageKey as string);
    const missing = await reconcileFileStorage(ctx);
    assert.equal(missing.match, false);
    assert.deepEqual(missing.metadataWithoutObject, [a.id]);

    // Объект-сирота (вне метаданных).
    await storage.putObject("org/ca00000000000000000001/doc/c99999999999999999999/ffffffffffffffffffffffffffffffff", new Uint8Array([9]));
    const orphaned = await reconcileFileStorage(ctx);
    assert.equal(orphaned.orphanObjects.length, 1);

    // Расхождение размера и хеша.
    const rowB = rowOf(b.id);
    const origSize = rowB.sizeBytes;
    const origSha = rowB.sha256;
    rowB.sizeBytes = -1;
    rowB.sha256 = "0".repeat(64);
    const drifted = await reconcileFileStorage(ctx);
    assert.ok(drifted.sizeMismatch.includes(b.id), "размер замечен");
    assert.ok(drifted.checksumMismatch.includes(b.id), "хеш замечен");

    // Ключ чужой организации в своей строке.
    rowB.sizeBytes = origSize;
    rowB.sha256 = origSha;
    const foreignKey = "org/cb00000000000000000001/doc/c00000000000000000002/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    rowB.storageKey = foreignKey;
    await storage.putObject(foreignKey, new TextEncoder().encode("данные-б"));
    const cross = await reconcileFileStorage(ctx);
    assert.deepEqual(cross.crossTenant, [b.id]);

    // Дубль ключа двумя строками.
    rowB.storageKey = rowOf(a.id).storageKey;
    const duped = await reconcileFileStorage(ctx);
    assert.equal(duped.duplicateKeys.length, 1, "дубль ключа найден");
  } finally {
    await drop(dir);
  }
});

