/**
 * Security-матрица файлового слоя S6 (§10 задачи):
 * anonymous, no membership, wrong tenant, correct tenant, wrong document id,
 * wrong purchase id, guessed object key, expired URL, private bucket,
 * server-only credentials.
 *
 * Сессии/флаг проверяются на route-уровне и в smoke (здесь у роутов нет
 * request-контекста): здесь — слой сервисов, где аноним = неизвестный userId.
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
import { deleteDocument, grantDocumentDownload, uploadDocument, type FileContext } from "./files.ts";
import { S3StorageAdapter } from "./s3.ts";

const ORG_A = "ca00000000000000000001";
const ORG_B = "cb00000000000000000001";
const U1 = "cu10000000000000000001";
const STRANGER = "cu99999999999999999999";
const SECRET = "matrix-secret";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

async function makeCtx() {
  const memory = createMemoryDb();
  memory.table("membership").push({ organizationId: ORG_A, userId: U1 });
  memory.table("membership").push({ organizationId: ORG_B, userId: U1 });
  const dir = await mkdtemp(join(tmpdir(), "s6-sec-"));
  const storage = new FsStorageAdapter({ dir, secret: SECRET });
  const db = memory.db;
  const scope = orgScope(ORG_A);
  await runLegacyImport({
    db,
    run: withRunner(db),
    scope,
    userId: U1,
    raw: standardBackupJson(),
    batchKey: `sec-${Math.random().toString(36).slice(2)}`,
  });
  const ctx: FileContext = { db, storage, scope, userId: U1 };
  return { memory, dir, storage, ctx };
}

async function drop(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

test("correct tenant: полный цикл разрешён", async () => {
  const { ctx, dir } = await makeCtx();
  try {
    const uploaded = await uploadDocument(ctx, { purchaseId: "pa", fileName: "Д.pdf", contentBase64: b64("x") });
    const grant = await grantDocumentDownload(ctx, uploaded.id);
    assert.ok(grant.url.length > 0);
    assert.deepEqual(await deleteDocument(ctx, uploaded.id), { ok: true, objectDeleted: true });
  } finally {
    await drop(dir);
  }
});

test("no membership и wrong tenant: отказ без раскрытия", async () => {
  const { ctx, dir } = await makeCtx();
  try {
    const stranger: FileContext = { ...ctx, userId: STRANGER };
    const foreign: FileContext = { ...ctx, scope: orgScope(ORG_B) };
    const messages: string[] = [];
    for (const c of [stranger, foreign]) {
      for (const fn of [
        () => uploadDocument(c, { purchaseId: "pa", fileName: "Д.pdf", contentBase64: b64("x") }),
        () => grantDocumentDownload(c, "whatever"),
        () => deleteDocument(c, "whatever"),
      ]) {
        try {
          await fn();
          assert.fail("доступ без членства обязан отклоняться");
        } catch (error) {
          messages.push((error as Error).message);
        }
      }
    }
    assert.equal(messages.length, 6);
    assert.ok(messages.every((m) => !m.includes("pa") && !m.includes("whatever")), "id не раскрываются");
  } finally {
    await drop(dir);
  }
});

test("wrong document id и wrong purchase id неотличимы от missing", async () => {
  const { ctx, dir } = await makeCtx();
  try {
    const missing: string[] = [];
    const foreign: string[] = [];
    for (const fn of [() => grantDocumentDownload(ctx, "nope"), () => deleteDocument(ctx, "nope")]) {
      try {
        await fn();
      } catch (error) {
        missing.push((error as Error).message);
      }
    }
    const uploaded = await uploadDocument(ctx, { purchaseId: "pa", fileName: "Д.pdf", contentBase64: b64("x") });
    const other: FileContext = { ...ctx, scope: orgScope(ORG_B) };
    for (const fn of [() => grantDocumentDownload(other, uploaded.id), () => deleteDocument(other, uploaded.id)]) {
      try {
        await fn();
      } catch (error) {
        foreign.push((error as Error).message);
      }
    }
    assert.deepEqual(foreign, missing, "чужие и отсутствующие отвечают одинаково");
    await deleteDocument(ctx, uploaded.id);
  } finally {
    await drop(dir);
  }
});

test("guessed object key не даёт ссылку: сырой ключ как id не резолвится", async () => {
  const { ctx, dir } = await makeCtx();
  try {
    const uploaded = await uploadDocument(ctx, { purchaseId: "pa", fileName: "Д.pdf", contentBase64: b64("x") });
    const rows = (await import("../db/repositories/index.ts")).orgRepositories(ctx.db, ctx.scope);
    const stored = (await rows.document.list()) as { id: string; storageKey: string }[];
    const realKey = stored.find((r) => r.id === uploaded.id)?.storageKey ?? "";
    assert.ok(realKey.startsWith("org/"), "предусловие: ключ существует");
    // Даже зная настоящий ключ, по нему ничего не выдать: grant принимает id.
    await assert.rejects(() => grantDocumentDownload(ctx, realKey), /не найдена/);
    await assert.rejects(() => deleteDocument(ctx, realKey), /не найдена/);
    await deleteDocument(ctx, uploaded.id);
  } finally {
    await drop(dir);
  }
});

test("expired URL: TTL из окружения чтится, ссылка короткоживущая", async () => {
  const { ctx, dir } = await makeCtx();
  const previous = process.env.S3_SIGNED_URL_TTL_SECONDS;
  try {
    process.env.S3_SIGNED_URL_TTL_SECONDS = "60";
    const uploaded = await uploadDocument(ctx, { purchaseId: "pa", fileName: "Д.pdf", contentBase64: b64("x") });
    const grant = await grantDocumentDownload(ctx, uploaded.id);
    assert.ok(grant.expiresIn > 0 && grant.expiresIn <= 60, `ttl=60, получено ${grant.expiresIn}`);
    await deleteDocument(ctx, uploaded.id);
  } finally {
    if (previous === undefined) {
      delete process.env.S3_SIGNED_URL_TTL_SECONDS;
    } else {
      process.env.S3_SIGNED_URL_TTL_SECONDS = previous;
    }
    await drop(dir);
  }
});

test("private bucket: публичных URL нет by construction", () => {
  const s3 = new S3StorageAdapter({
    endpoint: "https://s3.example.com",
    region: "ru-1",
    bucket: "docs",
    accessKeyId: "id",
    secretAccessKey: "secret",
    pathStyle: true,
  });
  assert.equal((s3 as unknown as Record<string, unknown>).getPublicUrl, undefined, "метода публичных URL нет");
});

test("server-only credentials: в ответах сервисов секретов нет", async () => {
  const { ctx, dir } = await makeCtx();
  const marker = "matrix-secret";
  try {
    const uploaded = await uploadDocument(ctx, { purchaseId: "pa", fileName: "Д.pdf", contentBase64: b64("x") });
    const grant = await grantDocumentDownload(ctx, uploaded.id);
    const blob = JSON.stringify({ uploaded, grant });
    assert.ok(!blob.includes(marker), "секрет fs-бэкенда не утекает в ответы");
    assert.ok(!blob.includes("storageKey"), "внутренний ключ не утекает в ответы");
    try {
      await grantDocumentDownload({ ...ctx, scope: orgScope(ORG_B) }, uploaded.id);
    } catch (error) {
      assert.ok(!(error as Error).message.includes(marker));
    }
    await deleteDocument(ctx, uploaded.id);
  } finally {
    await drop(dir);
  }
});
