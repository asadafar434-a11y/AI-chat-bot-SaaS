/**
 * Интеграционные проверки файлового слоя S6: TEST PostgreSQL + fs-бэкенд
 * во временной папке. Полный цикл upload → metadata → head → signed URL →
 * delete, изоляция, сверка.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type { PrismaClient } from "@prisma/client";

import type { DbClient } from "../db/db-client.ts";
import { orgScope } from "../db/org-scope.ts";
import { FsStorageAdapter } from "./fs.ts";
import {
  deleteDocument,
  grantDocumentDownload,
  reconcileFileStorage,
  uploadDocument,
  type FileContext,
} from "./files.ts";

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

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

type Ctx = {
  prisma: PrismaClient;
  dir: string;
  orgA: string;
  orgB: string;
  userId: string;
  ctx: FileContext;
};

async function makeCtx(tag: string): Promise<Ctx> {
  const { createPrismaClient } = await import("../db/client.ts");
  const prisma = createPrismaClient();
  const orgA = mkId(`a${tag}`);
  const orgB = mkId(`b${tag}`);
  const userId = mkId(`c${tag}`);
  await prisma.organization.createMany({ data: [{ id: orgA, name: `S6 ${tag} A` }, { id: orgB, name: `S6 ${tag} B` }] });
  await prisma.user.create({ data: { id: userId, email: `s6-${tag}-${userId}@example.test` } });
  await prisma.membership.createMany({
    data: [
      { organizationId: orgA, userId, role: "owner" },
      { organizationId: orgB, userId, role: "owner" },
    ],
  });
  await prisma.purchase.create({
    data: {
      organizationId: orgA,
      legacyId: `p-${tag}`,
      originalFormatVersion: 2,
      status: "draft",
      payload: { subject: "S6" },
      createdByUserId: null,
    },
  });
  const dir = await mkdtemp(join(tmpdir(), `s6-int-${tag}-`));
  const storage = new FsStorageAdapter({ dir, secret: `int-secret-${tag}` });
  const db = prisma as unknown as DbClient;
  return { prisma, dir, orgA, orgB, userId, ctx: { db, storage, scope: orgScope(orgA), userId } };
}

async function cleanup(ctx: Ctx): Promise<void> {
  const { prisma, dir, orgA, orgB, userId } = ctx;
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
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
}

test("S6: upload → metadata → signed URL → delete", { skip }, async () => {
  const ctx = await makeCtx("f1");
  try {
    const uploaded = await uploadDocument(ctx.ctx, {
      purchaseId: `p-f1`,
      fileName: "Договор.pdf",
      mimeType: "application/pdf",
      contentBase64: b64("текст договора"),
      ocr: true,
    });
    const row = await ctx.prisma.document.findFirst({
      where: { organizationId: ctx.orgA, id: uploaded.id },
    });
    assert.ok(row);
    assert.equal(row?.fileName, "Договор.pdf");
    assert.equal(row?.sizeBytes, Buffer.byteLength("текст договора", "utf8"));
    assert.ok((row?.sha256?.length ?? 0) === 64);
    assert.ok((row?.storageKey ?? "").startsWith(`org/${ctx.orgA}/doc/`));

    const head = await ctx.ctx.storage.headObject(row?.storageKey as string);
    assert.equal(head?.sizeBytes, row?.sizeBytes);
    assert.equal(head?.sha256, row?.sha256);

    const grant = await grantDocumentDownload(ctx.ctx, uploaded.id);
    assert.ok(grant.url.length > 0 && grant.expiresIn > 0);

    const removed = await deleteDocument(ctx.ctx, uploaded.id);
    assert.deepEqual(removed, { ok: true, objectDeleted: true });
    assert.equal(await ctx.prisma.document.count({ where: { organizationId: ctx.orgA } }), 0);
    await assert.rejects(() => deleteDocument(ctx.ctx, uploaded.id), /не найдена/);

    const events = await ctx.prisma.auditEvent.findMany({ where: { organizationId: ctx.orgA } });
    assert.deepEqual(
      events.map((e) => e.action).sort(),
      ["document.deleted", "document.downloaded", "document.uploaded"].sort(),
      "upload, grant и delete оставили события",
    );
    assert.ok(events.every((e) => e.actorUserId === ctx.userId && e.entityType === "document"));
    const uploadEvent = events.find((e) => e.action === "document.uploaded");
    assert.ok(!(JSON.stringify(uploadEvent?.metadata ?? {}).includes("Договор")), "имён файлов в метаданных нет");
  } finally {
    await cleanup(ctx);
  }
});

test("S6: чужая организация изолирована, сверка сходится", { skip }, async () => {
  const ctx = await makeCtx("f2");
  try {
    const uploaded = await uploadDocument(ctx.ctx, {
      purchaseId: `p-f2`,
      fileName: "Д.pdf",
      contentBase64: b64("x"),
    });
    const foreign: FileContext = { ...ctx.ctx, scope: orgScope(ctx.orgB) };
    await assert.rejects(() => grantDocumentDownload(foreign, uploaded.id), /не найдена/);
    await assert.rejects(() => deleteDocument(foreign, uploaded.id), /не найдена/);
    assert.equal(await ctx.prisma.document.count({ where: { organizationId: ctx.orgB } }), 0);

    const rec = await reconcileFileStorage(ctx.ctx);
    assert.equal(rec.match, true, JSON.stringify(rec));
    assert.equal(rec.checked, 1);
    await deleteDocument(ctx.ctx, uploaded.id);
  } finally {
    await cleanup(ctx);
  }
});
