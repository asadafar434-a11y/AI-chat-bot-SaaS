/**
 * Интеграционные проверки аудита S7 против живой PostgreSQL.
 *
 * Пропускают себя без `TEST_DATABASE_URL`. Ключевое свойство: мутация и событие
 * пишутся в одной транзакции, поэтому падение аудита откатывает и домен —
 * ложного успеха не бывает. Проверяются также изоляция, идентичность актора
 * и матрица отказов.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import type { PrismaClient } from "@prisma/client";

import type { TransactionRunner } from "../auth/transaction.ts";
import type { DbClient } from "../db/db-client.ts";
import { orgScope } from "../db/org-scope.ts";
import { createPurchase } from "../write/services.ts";

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

type Ctx = { prisma: PrismaClient; orgA: string; orgB: string; userId: string };

async function makeCtx(tag: string): Promise<Ctx> {
  const { createPrismaClient } = await import("../db/client.ts");
  const prisma = createPrismaClient();
  const orgA = mkId(`a${tag}`);
  const orgB = mkId(`b${tag}`);
  const userId = mkId(`c${tag}`);
  await prisma.organization.createMany({ data: [{ id: orgA, name: `S7 ${tag} A` }, { id: orgB, name: `S7 ${tag} B` }] });
  await prisma.user.create({ data: { id: userId, email: `s7-${tag}-${userId}@example.test` } });
  await prisma.membership.create({ data: { organizationId: orgA, userId, role: "owner" } });
  return { prisma, orgA, orgB, userId };
}

async function cleanup(ctx: Ctx): Promise<void> {
  const { prisma, orgA, orgB, userId } = ctx;
  const orgs = [orgA, orgB];
  await prisma.legacyImportBatch.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.document.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.purchase.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organizationProfile.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.userProfile.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.membership.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.$disconnect();
}

const purchase = (id: string) => ({
  id,
  subject: "Закупка",
  createdAt: "2026-09-20T10:00:00.000Z",
  files: [],
  unreadable: [],
  requirements: {},
});

test("S7: мутация пишет событие кто/где/что/когда", { skip }, async () => {
  const ctx = await makeCtx("a1");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    const db = ctx.prisma as unknown as DbClient;
    const result = await createPurchase(
      { db, run: getTransactionRunner(), scope: orgScope(ctx.orgA), userId: ctx.userId },
      purchase("p1"),
    );

    const events = await ctx.prisma.auditEvent.findMany({ where: { organizationId: ctx.orgA } });
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event.actorUserId, ctx.userId, "actor — из серверного контекста");
    assert.equal(event.action, "purchase.created");
    assert.equal(event.entityType, "purchase");
    assert.equal(event.entityId, result.id);
    assert.ok(event.createdAt instanceof Date, "метка времени ставит БД");
    assert.deepEqual(event.metadata, { legacyId: "p1" });
    const blob = JSON.stringify(event);
    assert.ok(!blob.includes("password") && !blob.includes("token"), "секретов нет");
  } finally {
    await cleanup(ctx);
  }
});

test("S7: падение аудита откатывает домен в той же транзакции", { skip }, async () => {
  const ctx = await makeCtx("a2");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    const realRun: TransactionRunner = getTransactionRunner();
    let attempt = 0;
    const flaky: TransactionRunner = (fn) =>
      realRun(async (txDb) => {
        attempt += 1;
        if (attempt === 1) {
          const faulty = {
            ...txDb,
            auditEvent: {
              ...txDb.auditEvent,
              create: async () => {
                throw new Error("audit down");
              },
            },
          };
          return fn(faulty as unknown as DbClient);
        }
        return fn(txDb);
      });
    const db = ctx.prisma as unknown as DbClient;
    const input = {
      db,
      scope: orgScope(ctx.orgA),
      userId: ctx.userId,
      run: flaky,
    } as Parameters<typeof createPurchase>[0];

    await assert.rejects(() => createPurchase(input, purchase("p1")), /audit down/);
    assert.equal(await ctx.prisma.purchase.count({ where: { organizationId: ctx.orgA } }), 0, "домен откачен");
    assert.equal(await ctx.prisma.auditEvent.count({ where: { organizationId: ctx.orgA } }), 0, "события нет");

    const retry = await createPurchase({ ...input, run: realRun }, purchase("p1"));
    assert.equal(retry.created, true, "повтор доводит операцию");
    assert.equal(await ctx.prisma.auditEvent.count({ where: { organizationId: ctx.orgA } }), 1);
  } finally {
    await cleanup(ctx);
  }
});

test("S7: чужой tenant не пишет и не читает чужие события", { skip }, async () => {
  const ctx = await makeCtx("a3");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    const db = ctx.prisma as unknown as DbClient;
    await createPurchase(
      { db, run: getTransactionRunner(), scope: orgScope(ctx.orgA), userId: ctx.userId },
      purchase("p1"),
    );

    const foreign = { db, run: getTransactionRunner(), scope: orgScope(ctx.orgB), userId: ctx.userId };
    await assert.rejects(() => createPurchase(foreign, purchase("x")), /NotFoundInScopeError/);
    assert.equal(await ctx.prisma.auditEvent.count({ where: { organizationId: ctx.orgB } }), 0);
    assert.equal(await ctx.prisma.auditEvent.count({ where: { organizationId: ctx.orgA } }), 1);

    const seen = await ctx.prisma.auditEvent.findMany({ where: { organizationId: ctx.orgB } });
    assert.deepEqual(seen, [], "чужих событий не видно");
  } finally {
    await cleanup(ctx);
  }
});

test("S7: actor — всегда переданный сервером userId; чужак отклоняется", { skip }, async () => {
  const ctx = await makeCtx("a4");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    const db = ctx.prisma as unknown as DbClient;
    const memberId = mkId("member");
    await ctx.prisma.user.create({ data: { id: memberId, email: `s7-a4-${memberId}@example.test` } });
    await ctx.prisma.membership.create({ data: { organizationId: ctx.orgA, userId: memberId, role: "member" } });
    const wctx = { db, run: getTransactionRunner(), scope: orgScope(ctx.orgA), userId: memberId };

    await createPurchase(wctx, purchase("p1"));
    const events = await ctx.prisma.auditEvent.findMany({ where: { organizationId: ctx.orgA } });
    assert.equal(events.length, 1);
    assert.equal(events[0].actorUserId, memberId, "actor — тот userId, что передал серверный вызывающий");

    const stranger = { ...wctx, userId: mkId("stranger") };
    await assert.rejects(() => createPurchase(stranger, purchase("p2")), /NotFoundInScopeError/);
    assert.equal(await ctx.prisma.auditEvent.count({ where: { organizationId: ctx.orgA } }), 1, "отклонённая мутация событий не оставляет");

    await ctx.prisma.membership.deleteMany({ where: { userId: memberId } });
    await ctx.prisma.user.deleteMany({ where: { id: memberId } });
  } finally {
    await cleanup(ctx);
  }
});

test("S7: сброс пароля пишет событие в организацию участника", { skip }, async () => {
  const ctx = await makeCtx("a6");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    const { createPasswordResetToken, resetPasswordWithToken } = await import("../auth/password-reset.ts");
    const { hashPassword } = await import("../auth/password.ts");
    const db = ctx.prisma as unknown as DbClient;
    const email = `s7-a6-${ctx.userId}@example.test`;
    await ctx.prisma.user.update({
      where: { id: ctx.userId },
      data: { email, passwordHash: await hashPassword("old-password-1") },
    });

    const issued = await createPasswordResetToken(db, email);
    assert.ok(issued);
    await resetPasswordWithToken(getTransactionRunner(), issued.token, "new-password-1");

    const events = await ctx.prisma.auditEvent.findMany({ where: { organizationId: ctx.orgA } });
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "auth.password_reset");
    assert.equal(events[0].entityType, "user");
    assert.equal(events[0].actorUserId, ctx.userId);
    assert.equal(events[0].entityId, ctx.userId);
  } finally {
    await cleanup(ctx);
  }
});

test("S7: матрица отказов не пишет событий", { skip }, async () => {
  const ctx = await makeCtx("a5");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    const db = ctx.prisma as unknown as DbClient;
    const wctx = { db, run: getTransactionRunner(), scope: orgScope(ctx.orgA), userId: ctx.userId };

    await createPurchase(wctx, purchase("p1"));
    // Дубликат: сама мутация отклонена — событие не пишется.
    await assert.rejects(() => createPurchase(wctx, purchase("p1")), /уже существует/);
    // Невалидный вход: отклонён до записи.
    await assert.rejects(() => createPurchase(wctx, { id: "" }), /непустой строковый id/);

    const events = await ctx.prisma.auditEvent.findMany({ where: { organizationId: ctx.orgA } });
    assert.equal(events.length, 1, "только успешная мутация оставила событие");
    assert.equal(events[0].action, "purchase.created");
  } finally {
    await cleanup(ctx);
  }
});
