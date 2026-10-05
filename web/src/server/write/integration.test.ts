/**
 * Интеграционные проверки server writes S5 против живой PostgreSQL.
 *
 * Пропускают себя без `TEST_DATABASE_URL`. Запись идёт через настоящий
 * `$transaction`: CRUD, каскады, изоляция, дубли, атомарность мультистрочных
 * операций и сверка после записи.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import type { PrismaClient } from "@prisma/client";

import type { TransactionRunner } from "../auth/transaction.ts";
import type { DbClient } from "../db/db-client.ts";
import { orgScope } from "../db/org-scope.ts";
import { runLegacyImport } from "../import/pipeline.ts";
import { standardBackupJson } from "../import/testing/fixtures.ts";
import { reconcileReads } from "../read/reconcile.ts";
import { getPurchase } from "../read/services.ts";
import {
  createFact,
  createPurchase,
  createSample,
  deleteFact,
  deletePurchase,
  deleteSample,
  replaceFact,
  replacePurchase,
  replacePurchaseDocuments,
  replaceSample,
  saveServerProfile,
  type WriteContext,
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

type Ctx = { prisma: PrismaClient; orgA: string; orgB: string; userId: string; wctx: WriteContext };

async function makeCtx(tag: string): Promise<Ctx> {
  const { createPrismaClient, getTransactionRunner } = await import("../db/client.ts");
  const prisma = createPrismaClient();
  const orgA = mkId(`a${tag}`);
  const orgB = mkId(`b${tag}`);
  const userId = mkId(`c${tag}`);
  await prisma.organization.createMany({ data: [{ id: orgA, name: `S5 ${tag} A` }, { id: orgB, name: `S5 ${tag} B` }] });
  await prisma.user.create({ data: { id: userId, email: `s5-${tag}-${userId}@example.test` } });
  await prisma.membership.create({ data: { organizationId: orgA, userId, role: "owner" } });
  const db = prisma as unknown as DbClient;
  return { prisma, orgA, orgB, userId, wctx: { db, run: getTransactionRunner(), scope: orgScope(orgA), userId } };
}

async function cleanup(ctx: Ctx): Promise<void> {
  const { prisma, orgA, orgB, userId } = ctx;
  const orgs = [orgA, orgB];
  await prisma.legacyImportBatch.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.document.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.purchase.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.fact.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.sample.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organizationProfile.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.userProfile.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.membership.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.$disconnect();
}

const purchase = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  subject: "Закупка",
  createdAt: "2026-09-20T10:00:00.000Z",
  files: [],
  unreadable: [],
  requirements: {},
  ...extra,
});

test("S5: purchase create/update/delete с каскадом документов", { skip }, async () => {
  const ctx = await makeCtx("w1");
  try {
    const created = await createPurchase(ctx.wctx, purchase("p1", { tpPrice: 5 }));
    assert.equal(created.created, true);
    assert.equal(created.legacyId, "p1");

    await assert.rejects(() => createPurchase(ctx.wctx, purchase("p1")), /уже существует/);
    assert.equal(await ctx.prisma.purchase.count({ where: { organizationId: ctx.orgA } }), 1, "дубля нет");

    const replaced = await replacePurchase(ctx.wctx, "p1", purchase("p1", { tpPrice: 7 }));
    assert.equal(replaced.created, false);
    const row = await ctx.prisma.purchase.findFirst({ where: { organizationId: ctx.orgA, legacyId: "p1" } });
    assert.equal((row?.payload as { tpPrice: number }).tpPrice, 7);
    assert.equal(row?.createdByUserId, ctx.userId, "автор — из сессии");

    const withDocs = await replacePurchaseDocuments(ctx.wctx, "p1", {
      purchase: purchase("p1", { tpPrice: 7 }),
      documents: [{ name: "А.pdf", text: "текст" }],
    });
    assert.equal(withDocs.documents, 1);
    assert.equal(await ctx.prisma.document.count({ where: { organizationId: ctx.orgA } }), 1);

    const removed = await deletePurchase(ctx.wctx, "p1");
    assert.deepEqual(removed, { documents: 1 }, "каскад удалил документ");
    assert.equal(await ctx.prisma.purchase.count({ where: { organizationId: ctx.orgA } }), 0);
    await assert.rejects(() => deletePurchase(ctx.wctx, "p1"), /NotFoundInScopeError/);

    const events = await ctx.prisma.auditEvent.findMany({ where: { organizationId: ctx.orgA } });
    assert.deepEqual(
      events.map((e) => e.action).sort(),
      ["purchase.created", "purchase.deleted", "purchase.documents.replaced", "purchase.updated"].sort(),
      "каждая мутация оставила событие",
    );
    assert.ok(events.every((e) => e.actorUserId === ctx.userId), "actor — вызывающий пользователь");
  } finally {
    await cleanup(ctx);
  }
});

test("S5: изоляция арендаторов и чужак", { skip }, async () => {
  const ctx = await makeCtx("w2");
  try {
    await createPurchase(ctx.wctx, purchase("p1"));
    const foreign = { ...ctx.wctx, scope: orgScope(ctx.orgB) };
    const stranger = { ...ctx.wctx, userId: mkId("stranger") };

    await assert.rejects(() => createPurchase(foreign, purchase("x")), /NotFoundInScopeError/);
    await assert.rejects(() => replacePurchase(foreign, "p1", purchase("p1")), /NotFoundInScopeError/);
    await assert.rejects(() => deletePurchase(foreign, "p1"), /NotFoundInScopeError/);
    await assert.rejects(() => createSample(foreign, { id: "s", name: "Н", text: "t", kinds: ["tp"], about: "" }), /NotFoundInScopeError/);
    await assert.rejects(() => createFact(foreign, { id: "f", kind: "license", title: "Т", source: {} }), /NotFoundInScopeError/);
    await assert.rejects(
      () => saveServerProfile(foreign, { profile: { inn: "1" } }),
      /NotFoundInScopeError/,
    );
    await assert.rejects(() => createPurchase(stranger, purchase("y")), /NotFoundInScopeError/);

    assert.equal(await ctx.prisma.purchase.count({ where: { organizationId: ctx.orgB } }), 0);
    assert.equal(await ctx.prisma.purchase.count({ where: { organizationId: ctx.orgA } }), 1);
  } finally {
    await cleanup(ctx);
  }
});

test("S5: samples/facts/profile CRUD", { skip }, async () => {
  const ctx = await makeCtx("w3");
  try {
    const s = await createSample(ctx.wctx, { id: "s1", name: "Ф.pdf", text: "текст", kinds: ["tp"], about: "Про" });
    assert.equal(s.created, true);
    await assert.rejects(
      () => createSample(ctx.wctx, { id: "s1", name: "Ф.pdf", text: "t", kinds: ["tp"], about: "" }),
      /уже существует/,
    );
    const rs = await replaceSample(ctx.wctx, "s1", { id: "s1", name: "Ф.pdf", text: "t", kinds: ["tp"], about: "Новое" });
    assert.equal(rs.created, false);
    await deleteSample(ctx.wctx, "s1");
    await assert.rejects(() => deleteSample(ctx.wctx, "s1"), /NotFoundInScopeError/);

    await createFact(ctx.wctx, { id: "f1", kind: "license", title: "Л", source: { type: "manual" } });
    const rf = await replaceFact(ctx.wctx, "f1", { id: "f1", kind: "license", title: "Л2", source: { type: "manual" } });
    assert.equal(rf.created, false);
    await deleteFact(ctx.wctx, "f1");

    const profile = await saveServerProfile(ctx.wctx, {
      profile: { fullName: "ООО", inn: "1", head: "И.", phone: "+7" },
      meta: { sources: {}, suggestions: [] },
    });
    assert.equal(profile.organizationId, ctx.orgA);
    assert.equal(profile.userId, ctx.userId);
    const again = await saveServerProfile(ctx.wctx, {
      profile: { fullName: "ООО", inn: "1", head: "И.", phone: "+7" },
      meta: { sources: {}, suggestions: [] },
    });
    assert.equal(again.created, false);

    assert.equal(await ctx.prisma.sample.count({ where: { organizationId: ctx.orgA } }), 0);
    assert.equal(await ctx.prisma.fact.count({ where: { organizationId: ctx.orgA } }), 0);
    assert.equal(await ctx.prisma.organizationProfile.count({ where: { organizationId: ctx.orgA } }), 1);
    assert.equal(await ctx.prisma.userProfile.count({ where: { userId: ctx.userId } }), 1);
  } finally {
    await cleanup(ctx);
  }
});

test("S5: конфликт не перезаписывает, транзакция атомарна", { skip }, async () => {
  const ctx = await makeCtx("w4");
  try {
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
    await assert.rejects(() => createPurchase(ctx.wctx, purchase("pa")), /уже существует/);
    const rows = await ctx.prisma.purchase.findMany({ where: { organizationId: ctx.orgA, legacyId: "pa" } });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].payload, { subject: "Чужая версия" });

    const { getTransactionRunner } = await import("../db/client.ts");
    const realRun: TransactionRunner = getTransactionRunner();
    let attempt = 0;
    const flaky: TransactionRunner = (fn) =>
      realRun(async (txDb) => {
        attempt += 1;
        if (attempt === 1) {
          let creates = 0;
          const inner = txDb.document.create.bind(txDb.document) as unknown as (...a: unknown[]) => Promise<unknown>;
          const faulty = {
            ...txDb,
            document: {
              ...txDb.document,
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
    const flakyCtx = { ...ctx.wctx, run: flaky };
    await assert.rejects(
      () =>
        replacePurchaseDocuments(flakyCtx, "pb", {
          purchase: purchase("pb"),
          documents: [
            { name: "А.pdf", text: "1" },
            { name: "Б.pdf", text: "2" },
          ],
        }),
      /injected fault/,
    );
    assert.equal(await ctx.prisma.purchase.count({ where: { organizationId: ctx.orgA, legacyId: "pb" } }), 0);
    assert.equal(await ctx.prisma.document.count({ where: { organizationId: ctx.orgA } }), 0);

    const ok = await replacePurchaseDocuments(ctx.wctx, "pb", {
      purchase: purchase("pb"),
      documents: [
        { name: "А.pdf", text: "1" },
        { name: "Б.pdf", text: "2" },
      ],
    });
    assert.equal(ok.documents, 2);
  } finally {
    await cleanup(ctx);
  }
});

test("S5: сверка после записи сходится", { skip }, async () => {
  const ctx = await makeCtx("w5");
  try {
    const { getTransactionRunner } = await import("../db/client.ts");
    await runLegacyImport({
      db: ctx.prisma as unknown as DbClient,
      run: getTransactionRunner(),
      scope: orgScope(ctx.orgA),
      userId: ctx.userId,
      raw: standardBackupJson(),
      batchKey: `s5-w5-${ctx.orgA}`,
    });
    await replacePurchase(ctx.wctx, "pa", {
      ...(JSON.parse(standardBackupJson()) as { purchases: Record<string, unknown>[] }).purchases.find(
        (p) => (p as { id: string }).id === "pa",
      ) as Record<string, unknown>,
      subject: "Поставка зала (изм.)",
    });

    const { parseBackup } = await import("@/lib/backup-format");
    const parsed = parseBackup(JSON.parse(standardBackupJson()));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    const dump = JSON.parse(JSON.stringify(parsed.dump)) as typeof parsed.dump;
    const pa = dump.purchases.find((p) => (p as { id: string }).id === "pa") as unknown as Record<string, unknown>;
    pa.subject = "Поставка зала (изм.)";
    const { comparisons, match } = await reconcileReads(
      { db: ctx.prisma as unknown as DbClient, scope: orgScope(ctx.orgA), userId: ctx.userId },
      dump,
    );
    assert.equal(match, true, JSON.stringify(comparisons.map((c) => [c.entity, c.missing, c.extra])));
    const read = await getPurchase(
      { db: ctx.prisma as unknown as DbClient, scope: orgScope(ctx.orgA), userId: ctx.userId },
      "pa",
    );
    assert.equal((read as unknown as { subject: string }).subject, "Поставка зала (изм.)");
  } finally {
    await cleanup(ctx);
  }
});
