/**
 * Интеграционные проверки переноса S3 против живой PostgreSQL.
 *
 * Пропускают себя без `TEST_DATABASE_URL`. Схема развёрнута заранее
 * (`prisma migrate deploy`); тест миграций не применяет. Ключевое отличие от
 * модульных проверок: запись идёт через настоящий `$transaction`, поэтому тест
 * прерывания доказывает реальный откат, а не только логику возобновления.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import type { PrismaClient } from "@prisma/client";

import type { TransactionRunner } from "../auth/transaction.ts";
import type { DbClient } from "../db/db-client.ts";
import { orgScope } from "../db/org-scope.ts";
import { orgRepositories } from "../db/repositories/index.ts";
import { runLegacyImport } from "./pipeline.ts";
import { standardBackupJson } from "./testing/fixtures.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (TEST_DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

after(async () => {
  const { disconnectPrisma } = await import("../db/client.ts");
  await disconnectPrisma();
});

/** Идентификатор вида cuid(), укладывается в VARCHAR(25). */
function mkId(tag: string): string {
  return `c${tag}${randomBytes(10).toString("hex")}`.slice(0, 25);
}

const skip = TEST_DATABASE_URL ? false : "TEST_DATABASE_URL не задан: интеграционная проверка пропущена";

type Ctx = {
  prisma: PrismaClient;
  orgA: string;
  orgB: string;
  userId: string;
};

async function makeCtx(tag: string): Promise<Ctx> {
  const { createPrismaClient } = await import("../db/client.ts");
  const prisma = createPrismaClient();
  const orgA = mkId(`a${tag}`);
  const orgB = mkId(`b${tag}`);
  const userId = mkId(`c${tag}`);
  await prisma.organization.createMany({ data: [{ id: orgA, name: `S3 ${tag} A` }, { id: orgB, name: `S3 ${tag} B` }] });
  await prisma.user.create({ data: { id: userId, email: `s3-${tag}-${userId}@example.test` } });
  await prisma.membership.createMany({
    data: [
      { organizationId: orgA, userId, role: "owner" },
      { organizationId: orgB, userId, role: "owner" },
    ],
  });
  return { prisma, orgA, orgB, userId };
}

async function cleanup(ctx: Ctx): Promise<void> {
  const { prisma, orgA, orgB, userId } = ctx;
  const orgs = [orgA, orgB];
  await prisma.legacyImportBatch.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.document.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.purchase.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.fact.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.sample.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organizationProfile.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.userProfile.deleteMany({ where: { userId } });
  await prisma.membership.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.$disconnect();
}

async function scopedCounts(ctx: Ctx, org: string) {
  const prisma = ctx.prisma;
  const where = { organizationId: org };
  return {
    purchase: await prisma.purchase.count({ where }),
    document: await prisma.document.count({ where }),
    fact: await prisma.fact.count({ where }),
    sample: await prisma.sample.count({ where }),
    organizationProfile: await prisma.organizationProfile.count({ where }),
    batch: await prisma.legacyImportBatch.count({ where }),
  };
}

test("S3: полный перенос на PostgreSQL — match и реальные колонки", { skip }, async () => {
  const ctx = await makeCtx("t1");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    const run = await runLegacyImport({
      db: ctx.prisma as unknown as DbClient,
      run: getTransactionRunner(),
      scope: orgScope(ctx.orgA),
      userId: ctx.userId,
      raw: standardBackupJson(),
      batchKey: `s3-i1-${ctx.orgA}`,
    });

    assert.equal(run.reconciliation.verdict, "match");
    assert.deepEqual(
      [run.reconciliation.counts.purchases.target, run.reconciliation.counts.documents.target, run.reconciliation.counts.facts.target, run.reconciliation.counts.samples.target],
      [4, 4, 2, 2],
    );
    assert.equal(run.reconciliation.aggregates.match, true);

    const pa = await ctx.prisma.purchase.findFirst({ where: { organizationId: ctx.orgA, legacyId: "pa" } });
    assert.equal(pa?.status, "submitted");
    assert.equal(pa?.originalFormatVersion, 2);
    assert.equal(pa?.createdByUserId, null);
    const doc = await ctx.prisma.document.findFirst({ where: { organizationId: ctx.orgA, legacyId: "pa:0" } });
    assert.equal(doc?.purchaseId, pa?.id, "документ привязан к закупке через purchaseId");
    assert.equal(doc?.storageKey, null, "тексты не кладутся в PostgreSQL");
    assert.equal(doc?.textKey, null);
    assert.ok((doc?.sha256?.length ?? 0) === 64, "отпечаток текста — в строке");
  } finally {
    await cleanup(ctx);
  }
});

test("S3: повтор того же файла не пишет ничего", { skip }, async () => {
  const ctx = await makeCtx("t2");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    const base = {
      db: ctx.prisma as unknown as DbClient,
      run: getTransactionRunner(),
      scope: orgScope(ctx.orgA),
      userId: ctx.userId,
      raw: standardBackupJson(),
    };
    await runLegacyImport({ ...base, batchKey: `s3-i2a-${ctx.orgA}` });
    const before = await scopedCounts(ctx, ctx.orgA);
    const second = await runLegacyImport({ ...base, batchKey: `s3-i2b-${ctx.orgA}` });

    assert.equal(second.resumed, true);
    assert.equal(second.reconciliation.verdict, "already-imported");
    assert.deepEqual(await scopedCounts(ctx, ctx.orgA), before);
  } finally {
    await cleanup(ctx);
  }
});

test("S3: dry-run не меняет PostgreSQL", { skip }, async () => {
  const ctx = await makeCtx("t3");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    const run = await runLegacyImport({
      db: ctx.prisma as unknown as DbClient,
      run: getTransactionRunner(),
      scope: orgScope(ctx.orgA),
      userId: ctx.userId,
      raw: standardBackupJson(),
      batchKey: `s3-i3-${ctx.orgA}`,
      dryRun: true,
    });

    assert.equal(run.reconciliation.verdict, "dry-run");
    assert.ok((run.plan.affected.length ?? 0) > 0, "план показывает затронутые сущности");
    assert.deepEqual(await scopedCounts(ctx, ctx.orgA), {
      purchase: 0,
      document: 0,
      fact: 0,
      sample: 0,
      organizationProfile: 0,
      batch: 0,
    });
  } finally {
    await cleanup(ctx);
  }
});

test("S3+N: ошибка посреди батча откатывается транзакцией, повтор доводит до match", { skip }, async () => {
  const ctx = await makeCtx("t4");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    const realRun = getTransactionRunner();
    let attempt = 0;
    const flaky: TransactionRunner = (fn) =>
      realRun(async (txDb) => {
        attempt += 1;
        if (attempt === 1) {
          let creates = 0;
          const inner = txDb.purchase.create.bind(txDb.purchase) as unknown as (
            ...a: unknown[]
          ) => Promise<unknown>;
          const faulty = {
            ...txDb,
            purchase: {
              ...txDb.purchase,
              create: async (...a: unknown[]) => {
                creates += 1;
                if (creates >= 2) {
                  throw new Error("injected fault");
                }
                return inner(...a);
              },
            },
          };
          return fn(faulty as unknown as DbClient);
        }
        return fn(txDb);
      });

    const base = {
      db: ctx.prisma as unknown as DbClient,
      scope: orgScope(ctx.orgA),
      userId: ctx.userId,
      raw: standardBackupJson(),
      batchKey: `s3-i4-${ctx.orgA}`,
    };
    await assert.rejects(() => runLegacyImport({ ...base, run: flaky }), /injected fault/);

    const failed = await ctx.prisma.legacyImportBatch.findFirst({ where: { batchKey: base.batchKey } });
    assert.equal(failed?.status, "failed", "прерванный батч помечен failed");
    assert.equal(await ctx.prisma.purchase.count({ where: { organizationId: ctx.orgA } }), 0, "транзакция откатила частичную запись");

    const resumed = await runLegacyImport({ ...base, run: realRun });
    assert.equal(resumed.reconciliation.verdict, "match");
    assert.equal(await ctx.prisma.purchase.count({ where: { organizationId: ctx.orgA } }), 4, "ни потерь, ни дублей");
    const done = await ctx.prisma.legacyImportBatch.findFirst({ where: { batchKey: base.batchKey } });
    assert.equal(done?.status, "completed");
  } finally {
    await cleanup(ctx);
  }
});

test("S3: конфликт не перезаписывает чужую строку", { skip }, async () => {
  const ctx = await makeCtx("t5");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    await ctx.prisma.purchase.create({
      data: {
        organizationId: ctx.orgA,
        legacyId: "pa",
        originalFormatVersion: 2,
        status: "draft",
        payload: { subject: "Чужая версия" },
        createdByUserId: null,
      },
    });
    const run = await runLegacyImport({
      db: ctx.prisma as unknown as DbClient,
      run: getTransactionRunner(),
      scope: orgScope(ctx.orgA),
      userId: ctx.userId,
      raw: standardBackupJson(),
      batchKey: `s3-i5-${ctx.orgA}`,
    });

    assert.deepEqual(run.plan.entities.find((e) => e.entity === "purchases")?.conflictLegacyIds, ["pa"]);
    assert.equal(run.reconciliation.verdict, "mismatch");
    const rows = await ctx.prisma.purchase.findMany({ where: { organizationId: ctx.orgA, legacyId: "pa" } });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].payload, { subject: "Чужая версия" });
  } finally {
    await cleanup(ctx);
  }
});

test("S3: две организации изолированы, чужак отклоняется", { skip }, async () => {
  const ctx = await makeCtx("t6");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    const base = {
      db: ctx.prisma as unknown as DbClient,
      run: getTransactionRunner(),
      userId: ctx.userId,
      raw: standardBackupJson(),
    };
    await runLegacyImport({ ...base, scope: orgScope(ctx.orgA), batchKey: `s3-i6a-${ctx.orgA}` });
    await runLegacyImport({ ...base, scope: orgScope(ctx.orgB), batchKey: `s3-i6b-${ctx.orgB}` });

    assert.equal((await scopedCounts(ctx, ctx.orgA)).purchase, 4);
    assert.equal((await scopedCounts(ctx, ctx.orgB)).purchase, 4);
    const cross = await ctx.prisma.purchase.findFirst({ where: { organizationId: ctx.orgB, legacyId: "pa" } });
    assert.ok(cross && cross.organizationId === ctx.orgB);

    await assert.rejects(
      () =>
        runLegacyImport({
          ...base,
          scope: orgScope(ctx.orgB),
          userId: mkId("stranger"),
          raw: standardBackupJson(),
          batchKey: `s3-i6c-${ctx.orgB}`,
        }),
      /no-membership/,
    );
  } finally {
    await cleanup(ctx);
  }
});

test("S3: scoped-чтение подтверждает изоляцию через репозитории", { skip }, async () => {
  const ctx = await makeCtx("t7");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    await runLegacyImport({
      db: ctx.prisma as unknown as DbClient,
      run: getTransactionRunner(),
      scope: orgScope(ctx.orgA),
      userId: ctx.userId,
      raw: standardBackupJson(),
      batchKey: `s3-i7-${ctx.orgA}`,
    });
    const foreign = await orgRepositories(ctx.prisma as unknown as DbClient, orgScope(ctx.orgB)).purchase.list();
    assert.equal(foreign.length, 0, "из чужого скоупа строк не видно");
  } finally {
    await cleanup(ctx);
  }
});
