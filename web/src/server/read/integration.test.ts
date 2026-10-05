/**
 * Интеграционные проверки server reads S4 против живой PostgreSQL.
 *
 * Пропускают себя без `TEST_DATABASE_URL`. Импорт выполняется настоящим
 * pipeline через настоящий `$transaction`, чтение — сервисами слоя 3.
 * Проверяют: данные читаются, чужая организация изолирована, дубли
 * legacyId отказывают явно, сверка чтения с копией сходится.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import type { PrismaClient } from "@prisma/client";

import type { DbClient } from "../db/db-client.ts";
import { orgScope } from "../db/org-scope.ts";
import { runLegacyImport } from "../import/pipeline.ts";
import { standardBackupJson } from "../import/testing/fixtures.ts";
import { reconcileReads } from "./reconcile.ts";
import {
  DuplicateLegacyIdError,
  getPurchase,
  listDocuments,
  listFacts,
  listPurchases,
  listSamples,
  readProfile,
  type ReadContext,
} from "./services.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (TEST_DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

after(async () => {
  const { disconnectPrisma } = await import("../db/client.ts");
  await disconnectPrisma();
});

function mkId(tag: string): string {
  return `c${tag}${randomBytes(10).toString("hex")}`.slice(0, 25);
}

const skip = TEST_DATABASE_URL ? false : "TEST_DATABASE_URL не задан: интеграционная проверка пропущена";

type Ctx = { prisma: PrismaClient; orgA: string; orgB: string; userId: string; ctx: ReadContext };

async function makeCtx(tag: string): Promise<Ctx> {
  const { createPrismaClient } = await import("../db/client.ts");
  const prisma = createPrismaClient();
  const orgA = mkId(`a${tag}`);
  const orgB = mkId(`b${tag}`);
  const userId = mkId(`c${tag}`);
  await prisma.organization.createMany({ data: [{ id: orgA, name: `S4 ${tag} A` }, { id: orgB, name: `S4 ${tag} B` }] });
  await prisma.user.create({ data: { id: userId, email: `s4-${tag}-${userId}@example.test` } });
  await prisma.membership.createMany({
    data: [
      { organizationId: orgA, userId, role: "owner" },
      { organizationId: orgB, userId, role: "owner" },
    ],
  });
  const db = prisma as unknown as DbClient;
  return { prisma, orgA, orgB, userId, ctx: { db, scope: orgScope(orgA), userId } };
}

async function importStandard(ctx: Ctx, key: string): Promise<void> {
  const { getTransactionRunner } = await import("../db/client.ts");
  await runLegacyImport({
    db: ctx.prisma as unknown as DbClient,
    run: getTransactionRunner(),
    scope: orgScope(ctx.orgA),
    userId: ctx.userId,
    raw: standardBackupJson(),
    batchKey: key,
  });
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

test("S4: чтение импортированных данных из PostgreSQL", { skip }, async () => {
  const ctx = await makeCtx("r1");
  try {
    await importStandard(ctx, `s4-r1-${ctx.orgA}`);

    const list = await listPurchases(ctx.ctx);
    assert.equal(list.length, 4);
    assert.equal((await getPurchase(ctx.ctx, "pa"))?.subject, "Поставка зала");

    const docs = await listDocuments(ctx.ctx, "pa");
    assert.equal(docs.length, 2);
    assert.equal(docs[0].text, null, "текстов нет до S6");

    const facts = await listFacts(ctx.ctx);
    assert.equal(facts.length, 2);

    const samples = await listSamples(ctx.ctx);
    assert.equal(samples.length, 2);

    const { profile } = await readProfile(ctx.ctx);
    assert.equal(profile.fullName, "ООО Ромашка");
    assert.equal(profile.head, "Иванов И. И.");
  } finally {
    await cleanup(ctx);
  }
});

test("S4: чужая организация изолирована на каждом пути", { skip }, async () => {
  const ctx = await makeCtx("r2");
  try {
    await importStandard(ctx, `s4-r2-${ctx.orgA}`);
    const foreign: ReadContext = { ...ctx.ctx, scope: orgScope(ctx.orgB) };

    assert.deepEqual(await listPurchases(foreign), []);
    assert.equal(await getPurchase(foreign, "pa"), null);
    assert.deepEqual(await listDocuments(foreign, "pa"), []);
    assert.deepEqual(await listFacts(foreign), []);
    assert.deepEqual(await listSamples(foreign), []);

    const stranger: ReadContext = { ...ctx.ctx, userId: mkId("stranger") };
    await assert.rejects(() => listPurchases(stranger), /NotFoundInScopeError/);
    await assert.rejects(() => readProfile(stranger), /NotFoundInScopeError/);
  } finally {
    await cleanup(ctx);
  }
});

test("S4: дубль legacyId отказывает явно", { skip }, async () => {
  const ctx = await makeCtx("r3");
  try {
    await importStandard(ctx, `s4-r3-${ctx.orgA}`);
    const first = await ctx.prisma.purchase.findFirst({
      where: { organizationId: ctx.orgA, legacyId: "pa" },
    });
    assert.ok(first);
    await ctx.prisma.purchase.create({
      data: {
        organizationId: ctx.orgA,
        legacyId: "pa",
        originalFormatVersion: 2,
        status: "draft",
        payload: {},
        createdByUserId: null,
      },
    });

    await assert.rejects(() => getPurchase(ctx.ctx, "pa"), DuplicateLegacyIdError);
  } finally {
    await cleanup(ctx);
  }
});

test("S4: сверка чтения с копией сходится на живых данных", { skip }, async () => {
  const ctx = await makeCtx("r4");
  try {
    await importStandard(ctx, `s4-r4-${ctx.orgA}`);
    const { parseBackup } = await import("@/lib/backup-format");
    const parsed = parseBackup(JSON.parse(standardBackupJson()));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    const { comparisons, match } = await reconcileReads(ctx.ctx, parsed.dump);
    assert.equal(match, true);
    for (const c of comparisons) {
      assert.equal(c.checksumMatch, true, `${c.entity}: checksum сошёлся`);
    }
  } finally {
    await cleanup(ctx);
  }
});
