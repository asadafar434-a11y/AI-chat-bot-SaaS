/**
 * S8 acceptance gap: недоступность PostgreSQL.
 *
 * Инъекция через TCP-прокси перед TEST PostgreSQL: клиент (pg-boss или бизнес-
 * клиент handler-а) получает отказ соединения, сервер и параллельная работа не
 * затрагиваются. Проверяется реальное поведение очереди/worker, а не только
 * классификатор ошибок.
 *
 * Пропускается без `TEST_DATABASE_URL`.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";

import { resetBossForTests, startBoss, stopBoss } from "./boss.ts";
import { enqueue } from "./enqueue.ts";
import { PermanentJobError, RetryableJobError } from "./queues.ts";
import { registerJobHandler } from "./worker.ts";
import { startTestBoss, waitFor } from "./testing/jobs.ts";
import { startPausableProxy, type PausableProxy } from "./testing/postgres-proxy.ts";

const TEST = process.env.TEST_DATABASE_URL;
const skip = TEST ? false : "TEST_DATABASE_URL не задан: интеграционная проверка пропущена";
const HOST = "127.0.0.1";
const PORT = 5432;

const adminPrisma = TEST
  ? new PrismaClient({ datasources: { db: { url: TEST } } })
  : (null as unknown as PrismaClient);

const mkId = (tag: string) => `c${tag}${randomBytes(10).toString("hex")}`.slice(0, 25);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

after(async () => {
  if (TEST) {
    await adminPrisma.$disconnect();
  }
});

async function makeOrg(tag: string): Promise<{ org: string; user: string }> {
  const org = mkId(`o${tag}`.slice(0, 2));
  const user = mkId(`u${tag}`.slice(0, 2));
  await adminPrisma.organization.create({ data: { id: org, name: `S8 dbfail ${tag}` } });
  await adminPrisma.user.create({ data: { id: user, email: `s8-dbfail-${tag}-${user}@example.test` } });
  await adminPrisma.membership.create({ data: { organizationId: org, userId: user, role: "owner" } });
  return { org, user };
}

async function cleanupOrg(org: string, user: string): Promise<void> {
  await adminPrisma.auditEvent.deleteMany({ where: { organizationId: org } });
  await adminPrisma.document.deleteMany({ where: { organizationId: org } });
  await adminPrisma.purchase.deleteMany({ where: { organizationId: org } });
  await adminPrisma.organizationProfile.deleteMany({ where: { organizationId: org } });
  await adminPrisma.userProfile.deleteMany({ where: { userId: user } });
  await adminPrisma.session.deleteMany({ where: { userId: user } });
  await adminPrisma.membership.deleteMany({ where: { organizationId: org } });
  await adminPrisma.user.deleteMany({ where: { id: user } });
  await adminPrisma.organization.deleteMany({ where: { id: org } });
}

/** Восстанавливает переменные окружения jobs после теста. */
async function withJobsEnv<T>(proxy: PausableProxy, schema: string, run: () => Promise<T>): Promise<T> {
  const prev = {
    enabled: process.env.JOBS_ENABLED,
    url: process.env.JOBS_DATABASE_URL,
    schema: process.env.JOBS_SCHEMA,
  };
  process.env.JOBS_ENABLED = "1";
  process.env.JOBS_DATABASE_URL = proxy.url("tender_lawyer_test");
  process.env.JOBS_SCHEMA = schema;
  resetBossForTests();
  try {
    return await run();
  } finally {
    await stopBoss().catch(() => {});
    resetBossForTests();
    if (prev.enabled === undefined) delete process.env.JOBS_ENABLED;
    else process.env.JOBS_ENABLED = prev.enabled;
    if (prev.url === undefined) delete process.env.JOBS_DATABASE_URL;
    else process.env.JOBS_DATABASE_URL = prev.url;
    if (prev.schema === undefined) delete process.env.JOBS_SCHEMA;
    else process.env.JOBS_SCHEMA = prev.schema;
  }
}

test("DB недоступна: enqueue не сообщает ложный durable успех; после восстановления — работает", { skip }, async () => {
  const { org, user } = await makeOrg("e");
  const proxy = await startPausableProxy({ host: HOST, port: PORT });
  const schema = `test_dbufail_${randomBytes(5).toString("hex")}`;
  try {
    await withJobsEnv(proxy, schema, async () => {
      await startBoss(); // поднимает схему через прокси
      await adminPrisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

      proxy.pause();
      let threw = false;
      let id: string | null = null;
      try {
        id = await enqueue("storage.reconcile", { organizationId: org, requestId: "e1", operationVersion: 1 });
      } catch {
        threw = true;
      }
      assert.equal(threw, true, "при недоступной БД enqueue бросает, а не возвращает id");
      assert.equal(id, null, "нет ложного durable enqueue");

      proxy.resume();
      await sleep(800);
      const id2 = await enqueue("storage.reconcile", { organizationId: org, requestId: "e1", operationVersion: 1 });
      assert.equal(typeof id2, "string", "после восстановления БД enqueue снова работает");
    });
  } finally {
    await proxy.close();
    await adminPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await cleanupOrg(org, user);
  }
});

test("worker теряет DB во время обработки: retryable failure → восстановление → успех, job не потерян", { skip }, async () => {
  const { org, user } = await makeOrg("w");
  const { boss, schema } = await startTestBoss(TEST as string);
  const domainProxy = await startPausableProxy({ host: HOST, port: PORT });
  const domain = new PrismaClient({
    datasources: { db: { url: `${domainProxy.url("tender_lawyer_test")}?schema=public&connect_timeout=2` } },
  });
  try {
    let attempts = 0;
    let sawRetryable = false;
    const handler = async (): Promise<{ status: "completed"; output?: Record<string, unknown> }> => {
      attempts += 1;
      if (attempts === 1) {
        domainProxy.pause(); // соединение с БД теряется посреди обработки
        try {
          await domain.organization.findFirst({ where: { id: org } });
        } catch {
          sawRetryable = true;
          setTimeout(() => domainProxy.resume(), 600); // БД восстанавливается
          throw new RetryableJobError("db", "потеря соединения с БД");
        } finally {
          domainProxy.resume();
        }
        throw new RetryableJobError("db", "потеря соединения с БД");
      }
      const row = await domain.organization.findFirst({ where: { id: org } });
      if (!row) {
        throw new PermanentJobError("no-org", "организация не найдена после восстановления");
      }
      return { status: "completed", output: { attempts } };
    };

    await registerJobHandler(boss, "storage.reconcile", handler, {
      retryLimit: 3,
      retryDelay: 1,
      retryDelayMax: 1,
      pollingIntervalSeconds: 1,
    });

    const id = await boss.send("storage.reconcile", { organizationId: org, requestId: "w1", operationVersion: 1 });
    assert.ok(id);

    await waitFor(() => attempts >= 2, 30_000);
    await waitFor(async () => (await boss.getJobById("storage.reconcile", id))?.state === "completed", 30_000);

    assert.equal(sawRetryable, true, "первая попытка упала именно на потере БД");
    assert.ok(attempts >= 2, "задача повторилась, а не потерялась");
    assert.ok(attempts <= 4, "повторы ограничены retryLimit, бесконечности нет");
    assert.equal(await adminPrisma.organization.count({ where: { id: org } }), 1, "tenant-данные не тронуты");
  } finally {
    await domain.$disconnect();
    await domainProxy.close();
    await boss.stop({ graceful: true });
    await adminPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await cleanupOrg(org, user);
  }
});

test("recovery после рестарта: queued job переживает недоступность БД и обрабатывается", { skip }, async () => {
  const { org, user } = await makeOrg("r");
  const proxy = await startPausableProxy({ host: HOST, port: PORT });
  const schema = `test_dbfail_${randomBytes(5).toString("hex")}`;
  try {
    await withJobsEnv(proxy, schema, async () => {
      const boss = await startBoss();
      const id = await enqueue("storage.reconcile", { organizationId: org, requestId: "r1", operationVersion: 1 });
      assert.equal(typeof id, "string", "задача поставлена до отключения БД");

      proxy.pause(); // БД недоступна
      await sleep(300);

      // Задача уже durable в БД: отключение не теряет её.
      proxy.resume();
      await sleep(500);

      let consumed = false;
      await registerJobHandler(
        boss,
        "storage.reconcile",
        async () => {
          consumed = true;
          return { status: "completed" };
        },
        { pollingIntervalSeconds: 1 },
      );
      await waitFor(() => consumed, 30_000);
      assert.equal(consumed, true, "после восстановления задача обработана без ручного вмешательства");
    });
  } finally {
    await proxy.close();
    await adminPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await cleanupOrg(org, user);
  }
});
