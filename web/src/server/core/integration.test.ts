/**
 * Phase 1: запуск core-модуля на живой PostgreSQL.
 * Пропускает себя без `TEST_DATABASE_URL`.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { validMedicalInput } from "../../lib/core/modules/medical/fixtures.ts";
import type { WriteContext } from "../write/services.ts";
import type { DbClient } from "../db/db-client.ts";
import { orgScope } from "../db/org-scope.ts";
import { createCoreRun, listCoreRuns } from "./runs.ts";

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

type Ctx = { prisma: PrismaClient; orgA: string; orgB: string; userId: string; ctx: WriteContext };

async function makeCtx(tag: string): Promise<Ctx> {
  const { createPrismaClient, getTransactionRunner } = await import("../db/client.ts");
  const prisma = createPrismaClient();
  const orgA = mkId(`a${tag}`);
  const orgB = mkId(`b${tag}`);
  const userId = mkId(`c${tag}`);
  await prisma.organization.createMany({
    data: [
      { id: orgA, name: `P1 ${tag} A` },
      { id: orgB, name: `P1 ${tag} B` },
    ],
  });
  await prisma.user.create({ data: { id: userId, email: `p1-${tag}-${userId}@example.test` } });
  await prisma.membership.create({ data: { organizationId: orgA, userId, role: "owner" } });
  const db = prisma as unknown as DbClient;
  return { prisma, orgA, orgB, userId, ctx: { db, run: getTransactionRunner(), scope: orgScope(orgA), userId } };
}

async function cleanup(ctx: Ctx): Promise<void> {
  const { prisma, orgA, orgB, userId } = ctx;
  const orgs = [orgA, orgB];
  await prisma.coreRun.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.membership.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.$disconnect();
}

test("Phase 1: запуск сохраняется, аудит пишется, организация изолирована", { skip }, async () => {
  const ctx = await makeCtx("r1");
  try {
    const created = await createCoreRun(ctx.ctx, validMedicalInput);

    const rows = await ctx.prisma.coreRun.findMany({ where: { organizationId: ctx.orgA } });
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.id, created.id);
    assert.equal(row.organizationId, ctx.orgA);
    assert.equal(row.createdByUserId, ctx.userId);
    assert.equal(row.moduleKey, "medical");
    assert.equal(row.outcome, "prepare_application");
    assert.equal(row.riskScore, 0);
    assert.deepEqual(row.input, validMedicalInput);

    const events = await ctx.prisma.auditEvent.findMany({ where: { organizationId: ctx.orgA } });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.action, "core.run.created");
    assert.equal(events[0]?.entityId, created.id);

    const list = await listCoreRuns(ctx.ctx);
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, created.id);

    const foreignCtx: WriteContext = { ...ctx.ctx, scope: orgScope(ctx.orgB) };
    await assert.rejects(() => createCoreRun(foreignCtx, validMedicalInput), /NotFoundInScope|членств/i);
    await assert.rejects(() => listCoreRuns({ ...foreignCtx, userId: ctx.userId }), /NotFoundInScope|членств/i);
  } finally {
    await cleanup(ctx);
  }
});

test("Phase 1: запись coreRun и аудита откатывается вместе", { skip }, async () => {
  const ctx = await makeCtx("r2");
  try {
    await assert.rejects(async () => {
      await ctx.prisma.$transaction(async (tx) => {
        const txDb = tx as unknown as DbClient;
        const txCtx: WriteContext = { ...ctx.ctx, db: txDb, run: (fn) => fn(txDb) };
        await createCoreRun(txCtx, validMedicalInput);
        throw new Error("rollback after core run");
      });
    }, /rollback after core run/);

    assert.equal(await ctx.prisma.coreRun.count({ where: { organizationId: ctx.orgA } }), 0);
    assert.equal(await ctx.prisma.auditEvent.count({ where: { organizationId: ctx.orgA } }), 0);
  } finally {
    await cleanup(ctx);
  }
});
