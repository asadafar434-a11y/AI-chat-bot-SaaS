/**
 * Golden-reads S4: инфраструктура прогона эталонных пар против server reads.
 *
 * Пары — те же `web/tests/golden/cases/*.backup.json` (+ `.expected.json`);
 * чтение сверяется с необязательной секцией `expected.reads`. Самих эталонов
 * пока нет — тест проходит с пометкой. Формат секции описан в
 * `docs/stage-11/golden-standards/README.md` (§Server reads).
 *
 * Требуется живая TEST PostgreSQL: чтение идёт сервисами слоя 3 через
 * настоящий `$transaction` импорта. Контекст (org/user) создаётся и удаляется
 * внутри теста, чужих данных не касается.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

import type { DbClient } from "../db/db-client.ts";
import { orgScope } from "../db/org-scope.ts";
import { runLegacyImport } from "../import/pipeline.ts";
import { listFacts, listPurchases, listSamples, readProfile } from "./services.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (TEST_DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

after(async () => {
  const { disconnectPrisma } = await import("../db/client.ts");
  await disconnectPrisma();
});

const skip = TEST_DATABASE_URL ? false : "TEST_DATABASE_URL не задан: golden-reads пропущены";

const CASES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "golden", "cases");

function mkId(tag: string): string {
  return `c${tag}${randomBytes(10).toString("hex")}`.slice(0, 25);
}

async function cleanup(prisma: PrismaClient, org: string, userId: string): Promise<void> {
  await prisma.legacyImportBatch.deleteMany({ where: { organizationId: org } });
  await prisma.document.deleteMany({ where: { organizationId: org } });
  await prisma.purchase.deleteMany({ where: { organizationId: org } });
  await prisma.fact.deleteMany({ where: { organizationId: org } });
  await prisma.sample.deleteMany({ where: { organizationId: org } });
  await prisma.organizationProfile.deleteMany({ where: { organizationId: org } });
  await prisma.userProfile.deleteMany({ where: { userId } });
  await prisma.membership.deleteMany({ where: { organizationId: org } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: org } });
}

test("golden: server reads", { skip }, async () => {
  let files: string[] = [];
  try {
    files = (await readdir(CASES)).filter((f) => f.endsWith(".backup.json")).sort();
  } catch {
    files = [];
  }
  if (files.length === 0) {
    assert.ok(true, "эталонов пока нет: инфраструктура готова, ждём реальные обезличенные пары");
    return;
  }
  const { createPrismaClient, getTransactionRunner } = await import("../db/client.ts");
  for (const file of files) {
    const name = file.replace(/\.backup\.json$/, "");
    const raw = await readFile(join(CASES, file), "utf8");
    const expected = JSON.parse(await readFile(join(CASES, `${name}.expected.json`), "utf8")) as {
      reads?: {
        purchases?: { count?: number; ids?: string[] };
        facts?: { count?: number };
        samples?: { count?: number };
        profile?: Record<string, string>;
      };
    };
    if (!expected.reads) {
      continue;
    }
    const prisma = createPrismaClient();
    const org = mkId(`g${name}`.slice(0, 3));
    const userId = mkId("hzz");
    try {
      await prisma.organization.create({ data: { id: org, name: `Golden reads ${name}` } });
      await prisma.user.create({ data: { id: userId, email: `golden-reads-${name}@example.test` } });
      await prisma.membership.create({ data: { organizationId: org, userId, role: "owner" } });
      await runLegacyImport({
        db: prisma as unknown as DbClient,
        run: getTransactionRunner(),
        scope: orgScope(org),
        userId,
        raw,
        batchKey: `golden-reads-${name}`,
      });
      const ctx = { db: prisma as unknown as DbClient, scope: orgScope(org), userId };
      const want = expected.reads;
      if (want.purchases) {
        const list = await listPurchases(ctx);
        if (want.purchases.count !== undefined) {
          assert.equal(list.length, want.purchases.count, `${name}: purchases.count`);
        }
        if (want.purchases.ids !== undefined) {
          assert.deepEqual(
            list.map((p) => p.id).sort(),
            [...want.purchases.ids].sort(),
            `${name}: purchases.ids`,
          );
        }
      }
      if (want.facts?.count !== undefined) {
        assert.equal((await listFacts(ctx)).length, want.facts.count, `${name}: facts.count`);
      }
      if (want.samples?.count !== undefined) {
        assert.equal((await listSamples(ctx)).length, want.samples.count, `${name}: samples.count`);
      }
      if (want.profile !== undefined) {
        const { profile } = await readProfile(ctx);
        for (const [key, value] of Object.entries(want.profile)) {
          assert.equal(
            (profile as unknown as Record<string, string>)[key],
            value,
            `${name}: profile.${key}`,
          );
        }
      }
    } finally {
      await cleanup(prisma, org, userId);
      await prisma.$disconnect();
    }
  }
});
