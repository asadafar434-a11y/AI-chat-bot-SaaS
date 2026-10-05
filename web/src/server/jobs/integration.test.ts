/**
 * Интеграционные проверки S8 на реальном pg-boss + TEST PostgreSQL.
 *
 * Пропускают себя без `TEST_DATABASE_URL`. Проверяется настоящий путь:
 * постановка задачи (в т.ч. транзакционная) → реальный worker потребляет →
 * handler выполняет операцию → результат в PostgreSQL и объектном хранилище →
 * audit event. Плюс отказы: retry, терминальный отказ, откат транзакции,
 * подмена tenant в payload, durability при перезапуске, идемпотентность.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { auditEvent } from "../audit/service.ts";
import type { AuditInput } from "../audit/service.ts";
import type { DbClient } from "../db/db-client.ts";
import type { OrgScope } from "../db/org-scope.ts";
import { FsStorageAdapter } from "../storage/fs.ts";
import { documentObjectKey } from "../storage/keys.ts";
import {
  documentExtractHandler,
  setJobRuntimeForTests,
  type DocumentTextExtractor,
  type JobOutcome,
} from "./handlers.ts";
import { enqueueInTx } from "./enqueue.ts";
import type { DocumentExtractJob } from "./queues.ts";
import { RetryableJobError } from "./queues.ts";
import { registerJobHandler } from "./worker.ts";
import { startTestBoss, startTestBossWithSchema, waitFor } from "./testing/jobs.ts";

const TEST = process.env.TEST_DATABASE_URL;

if (TEST) {
  process.env.DATABASE_URL = TEST;
}

const skip = TEST ? false : "TEST_DATABASE_URL не задан: интеграционная проверка пропущена";

let prisma: PrismaClient;
const schemas: string[] = [];
const tempDirs: string[] = [];

before(async () => {
  if (!TEST) {
    return;
  }
  const { createPrismaClient } = await import("../db/client.ts");
  prisma = createPrismaClient();
});

after(async () => {
  if (!TEST) {
    return;
  }
  for (const schema of schemas) {
    try {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } catch {
      // схема могла не создаться — не мешает завершению
    }
  }
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  await prisma.$disconnect();
});

const mkId = (tag: string) => `c${tag}${randomBytes(10).toString("hex")}`.slice(0, 25);

async function makeOrg(tag: string): Promise<{ org: string; user: string }> {
  const org = mkId(`o${tag}`.slice(0, 2));
  const user = mkId(`u${tag}`.slice(0, 2));
  await prisma.organization.create({ data: { id: org, name: `S8 ${tag}` } });
  await prisma.user.create({ data: { id: user, email: `s8-${tag}-${user}@example.test` } });
  await prisma.membership.create({ data: { organizationId: org, userId: user, role: "owner" } });
  return { org, user };
}

async function cleanupOrg(org: string, user: string): Promise<void> {
  await prisma.auditEvent.deleteMany({ where: { organizationId: org } });
  await prisma.document.deleteMany({ where: { organizationId: org } });
  await prisma.purchase.deleteMany({ where: { organizationId: org } });
  await prisma.organizationProfile.deleteMany({ where: { organizationId: org } });
  await prisma.userProfile.deleteMany({ where: { userId: user } });
  await prisma.session.deleteMany({ where: { userId: user } });
  await prisma.membership.deleteMany({ where: { organizationId: org } });
  await prisma.user.deleteMany({ where: { id: user } });
  await prisma.organization.deleteMany({ where: { id: org } });
}

async function makeStorage(): Promise<FsStorageAdapter> {
  const dir = await mkdtemp(join(tmpdir(), "s8-jobs-"));
  tempDirs.push(dir);
  return new FsStorageAdapter({ dir, secret: "s8-test-secret" });
}

const fakeExtract: DocumentTextExtractor = async (bytes, fileName) => ({
  ok: true,
  text: ` извлечено ${bytes.length} байт из ${fileName} `,
});

function useRuntime(storage: FsStorageAdapter): void {
  setJobRuntimeForTests({
    db: prisma as unknown as DbClient,
    storage,
    extractText: fakeExtract,
    audit: auditEvent as unknown as (db: DbClient, scope: OrgScope, input: AuditInput) => Promise<unknown>,
  });
}

test("S8: mutation + tx-enqueue → worker → text → audit", { skip }, async () => {
  const { org, user } = await makeOrg("a");
  const storage = await makeStorage();
  const { boss, schema } = await startTestBoss(TEST as string);
  schemas.push(schema);
  try {
    useRuntime(storage);
    const bytes = new TextEncoder().encode("содержимое документа");
    const { getRawTransactionRunner } = await import("../db/client.ts");
    const runTx = getRawTransactionRunner();

    let docId = "";
    await runTx(async (db, tx) => {
      const doc = (await db.document.create({
        data: {
          organizationId: org,
          fileName: "doc.txt",
          mimeType: "text/plain",
          sizeBytes: bytes.length,
          sha256: "0".repeat(64),
          storageKey: null,
          textKey: null,
          readError: null,
        },
      })) as { id: string };
      docId = doc.id;
      const key = documentObjectKey(org, docId);
      await db.document.updateMany({ where: { id: docId }, data: { storageKey: key } });
      await storage.putObject(key, bytes, { contentType: "text/plain" });
      // задача ставится в той же транзакции, что и доменная мутация
      await enqueueInTx(boss, tx, "document.extract", {
        documentId: docId,
        organizationId: org,
        operationVersion: 1,
      });
    });

    const extractHandler = (job: { id: string; data: unknown }): Promise<JobOutcome> =>
      documentExtractHandler(job as { data: DocumentExtractJob });
    await registerJobHandler(boss, "document.extract", extractHandler, {
      retryLimit: 0,
      pollingIntervalSeconds: 1,
    });

    await waitFor(
      async () => (await prisma.auditEvent.count({ where: { organizationId: org, action: "document.extracted" } })) === 1,
    );

    const doc = await prisma.document.findUnique({ where: { id: docId } });
    assert.ok(doc?.textKey, "textKey заполнен handler-ом");
    const text = await storage.getObject(doc?.textKey as string);
    assert.ok(text, "текст сохранён в объектное хранилище");
    assert.match(Buffer.from(text?.bytes ?? new Uint8Array()).toString("utf8"), /извлечено/);

    const event = await prisma.auditEvent.findFirst({ where: { organizationId: org, action: "document.extracted" } });
    assert.equal(event?.actorUserId, null, "системное событие без случайного actor");
    assert.equal(event?.entityType, "document");
    assert.equal(event?.entityId, docId);
  } finally {
    setJobRuntimeForTests(null);
    await boss.stop({ graceful: true });
    await cleanupOrg(org, user);
  }
});

test("S8: откат транзакции не оставляет job и строку", { skip }, async () => {
  const { org, user } = await makeOrg("b");
  const { boss, schema } = await startTestBoss(TEST as string);
  schemas.push(schema);
  try {
    const { getRawTransactionRunner } = await import("../db/client.ts");
    const runTx = getRawTransactionRunner();
    await assert.rejects(
      () =>
        runTx(async (db, tx) => {
          await db.document.create({
            data: {
              organizationId: org,
              fileName: "x.txt",
              sizeBytes: 1,
              sha256: "0".repeat(64),
              storageKey: null,
              textKey: null,
              readError: null,
            },
          });
          await enqueueInTx(boss, tx, "document.extract", {
            documentId: "cplaceholder000000000000",
            organizationId: org,
            operationVersion: 1,
          });
          throw new Error("rollback-on-purpose");
        }),
      /rollback-on-purpose/,
    );

    assert.equal(await prisma.document.count({ where: { organizationId: org } }), 0, "строка откачена");
    const stats = await boss.getQueueStats("document.extract");
    assert.equal(stats[0]?.queuedCount ?? 0, 0, "job не появился после отката");
  } finally {
    await boss.stop({ graceful: true });
    await cleanupOrg(org, user);
  }
});

test("S8: повторяемая ошибка → retry с backoff → успех", { skip }, async () => {
  const { org, user } = await makeOrg("c");
  const { boss, schema } = await startTestBoss(TEST as string);
  schemas.push(schema);
  try {
    let attempts = 0;
    await registerJobHandler(
      boss,
      "storage.reconcile",
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new RetryableJobError("temporary", "временная ошибка");
        }
        return { status: "completed", output: { attempts } };
      },
      { retryLimit: 3, retryDelay: 1, retryDelayMax: 1, pollingIntervalSeconds: 1 },
    );
    const id = await boss.send("storage.reconcile", { organizationId: org, requestId: "c", operationVersion: 1 });
    assert.ok(id);

    await waitFor(() => attempts >= 3, 25_000);
    await waitFor(async () => (await boss.getJobById("storage.reconcile", id))?.state === "completed", 25_000);
    assert.equal(attempts, 3, "успех с третьей попытки");
  } finally {
    await boss.stop({ graceful: true });
    await cleanupOrg(org, user);
  }
});

test("S8: терминальный отказ → deadletter, повторов нет", { skip }, async () => {
  const { org, user } = await makeOrg("d");
  const { boss, schema } = await startTestBoss(TEST as string);
  schemas.push(schema);
  try {
    let attempts = 0;
    await registerJobHandler(
      boss,
      "storage.reconcile",
      async () => {
        attempts += 1;
        return { status: "permanent", error: "unsupported" };
      },
      { retryLimit: 3, retryDelay: 1, retryDelayMax: 1, pollingIntervalSeconds: 1 },
    );
    const id = await boss.send("storage.reconcile", { organizationId: org, requestId: "d", operationVersion: 1 });
    assert.ok(id);

    await waitFor(async () => (await boss.getJobById("storage.reconcile", id))?.state === "failed", 25_000);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(attempts, 1, "терминальный отказ не повторяется");
  } finally {
    await boss.stop({ graceful: true });
    await cleanupOrg(org, user);
  }
});

test("S8: подмена organizationId в payload не даёт трогать чужой документ", { skip }, async () => {
  const a = await makeOrg("e1");
  const b = await makeOrg("e2");
  const storage = await makeStorage();
  const { boss, schema } = await startTestBoss(TEST as string);
  schemas.push(schema);
  try {
    useRuntime(storage);
    const doc = await prisma.document.create({
      data: {
        organizationId: a.org,
        fileName: "a.txt",
        sizeBytes: 1,
        sha256: "0".repeat(64),
        storageKey: documentObjectKey(a.org, "cplaceholder000000000000"),
        textKey: null,
        readError: null,
      },
    });

    let ran = 0;
    const wrapper = async (job: { id: string; data: unknown }): Promise<JobOutcome> => {
      ran += 1;
      return documentExtractHandler(job as { data: DocumentExtractJob });
    };
    await registerJobHandler(boss, "document.extract", wrapper, { pollingIntervalSeconds: 1 });
    // payload подставлен сервером с чужим organizationId (имитация порчи)
    const id = await boss.send("document.extract", { documentId: doc.id, organizationId: b.org, operationVersion: 1 });
    assert.ok(id);

    await waitFor(async () => (await boss.getJobById("document.extract", id))?.state === "failed", 25_000);
    assert.equal(ran, 1);
    const after = await prisma.document.findUnique({ where: { id: doc.id } });
    assert.equal(after?.textKey, null, "чужой документ не изменён");
    assert.equal(await prisma.auditEvent.count({ where: { organizationId: b.org } }), 0, "событий в чужой организации нет");
  } finally {
    setJobRuntimeForTests(null);
    await boss.stop({ graceful: true });
    await cleanupOrg(a.org, a.user);
    await cleanupOrg(b.org, b.user);
  }
});

test("S8: повторная доставка extraction идемпотентна", { skip }, async () => {
  const { org, user } = await makeOrg("f");
  const storage = await makeStorage();
  try {
    useRuntime(storage);
    const bytes = new TextEncoder().encode("данные");
    const doc = await prisma.document.create({
      data: {
        organizationId: org,
        fileName: "f.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        sha256: "0".repeat(64),
        storageKey: null,
        textKey: null,
        readError: null,
      },
    });
    const key = documentObjectKey(org, doc.id);
    await prisma.document.update({ where: { id: doc.id }, data: { storageKey: key } });
    await storage.putObject(key, bytes, { contentType: "text/plain" });

    const data = { documentId: doc.id, organizationId: org, operationVersion: 1 as const };
    const first = await documentExtractHandler({ data });
    const second = await documentExtractHandler({ data });

    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
    assert.deepEqual(second.output, { skipped: true }, "повтор пропускается");
    assert.equal(
      await prisma.auditEvent.count({ where: { organizationId: org, action: "document.extracted" } }),
      1,
      "событие ровно одно",
    );
  } finally {
    setJobRuntimeForTests(null);
    await cleanupOrg(org, user);
  }
});

test("S8: задача переживает перезапуск boss (durability)", { skip }, async () => {
  const { org, user } = await makeOrg("g");
  const { boss, schema } = await startTestBoss(TEST as string);
  schemas.push(schema);
  let boss2 = boss;
  try {
    await boss.send("storage.reconcile", { organizationId: org, requestId: "g", operationVersion: 1 });
    assert.equal(((await boss.getQueueStats("storage.reconcile"))[0]?.queuedCount ?? 0), 1);
    await boss.stop({ graceful: true });

    const restarted = await startTestBossWithSchema(TEST as string, schema);
    boss2 = restarted.boss;
    assert.equal(
      ((await boss2.getQueueStats("storage.reconcile"))[0]?.queuedCount ?? 0),
      1,
      "задача осталась в очереди после перезапуска",
    );

    let consumed = false;
    await registerJobHandler(
      boss2,
      "storage.reconcile",
      async () => {
        consumed = true;
        return { status: "completed" };
      },
      { pollingIntervalSeconds: 1 },
    );
    await waitFor(() => consumed, 25_000);
  } finally {
    await boss2.stop({ graceful: true });
    await cleanupOrg(org, user);
  }
});

