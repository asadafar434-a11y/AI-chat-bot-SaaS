/**
 * Reconciliation write-path S5: мутация применяется, затем серверное
 * состояние сверяется с соответствующим legacy-состоянием по каноническим
 * правилам. Сценарии: parity после мутации, отсутствие на одной из сторон,
 * расхождение полей, удаление, чужая организация, дубль legacyId.
 *
 * Сверка — не часть production request path: только тесты и диагностика.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { Dump } from "@/lib/backup-format";
import { withRunner } from "../auth/transaction.ts";
import { createMemoryDb } from "../auth/testing/memory-db.ts";
import type { MemoryDb } from "../auth/testing/memory-db.ts";
import { orgScope } from "../db/org-scope.ts";
import { runLegacyImport } from "../import/pipeline.ts";
import { standardBackupJson } from "../import/testing/fixtures.ts";
import { reconcileReads } from "./reconcile.ts";
import type { ReadContext } from "./services.ts";
import {
  createSample,
  deletePurchase,
  deleteSample,
  replacePurchase,
  type WriteContext,
} from "../write/services.ts";

const ORG_A = "ca00000000000000000001";
const ORG_B = "cb00000000000000000001";
const U1 = "cu10000000000000000001";

function makeCtx(): { memory: MemoryDb; ctx: ReadContext } {
  const memory = createMemoryDb();
  memory.table("membership").push({ organizationId: ORG_A, userId: U1 });
  const db = memory.db;
  return { memory, ctx: { db, scope: orgScope(ORG_A), userId: U1 } };
}

const wctx = (ctx: ReadContext): WriteContext => ({ ...ctx, run: withRunner(ctx.db) });

async function importStandard(memory: MemoryDb, key: string): Promise<Dump> {
  const db = memory.db;
  const raw = standardBackupJson();
  await runLegacyImport({
    db,
    run: withRunner(db),
    scope: orgScope(ORG_A),
    userId: U1,
    raw,
    batchKey: key,
  });
  return JSON.parse(raw) as unknown as Dump;
}

test("parity: та же мутация с обеих сторон — сверка сходится", async () => {
  const { ctx, memory } = makeCtx();
  const dump = await importStandard(memory, "rw1");

  const legacy = JSON.parse(JSON.stringify(dump)) as unknown as {
    purchases: Record<string, unknown>[];
  } & Dump;
  const pa = legacy.purchases.find((p) => (p as { id: string }).id === "pa") as Record<string, unknown>;
  assert.ok(pa);
  const mutated = { ...pa, subject: "Поставка зала (изм.)" };
  await replacePurchase(wctx(ctx), "pa", mutated);
  pa.subject = "Поставка зала (изм.)";

  const { comparisons, match } = await reconcileReads(ctx, legacy);
  assert.equal(match, true, JSON.stringify(comparisons.map((c) => [c.entity, c.missing, c.extra])));
});

test("server missing: удалённая на сервере строка видна как missing", async () => {
  const { ctx, memory } = makeCtx();
  const dump = await importStandard(memory, "rw2");

  await deletePurchase(wctx(ctx), "pa");
  const { comparisons, match } = await reconcileReads(ctx, dump);
  assert.equal(match, false);
  assert.deepEqual(comparisons.find((c) => c.entity === "purchases")?.missing, ["pa"]);
});

test("legacy missing: созданная на сервере строка видна как extra", async () => {
  const { ctx, memory } = makeCtx();
  const dump = await importStandard(memory, "rw3");

  await createSample(wctx(ctx), {
    id: "sx",
    name: "Н.pdf",
    text: "t",
    kinds: ["tp"],
    about: "",
  });
  const { comparisons, match } = await reconcileReads(ctx, dump);
  assert.equal(match, false);
  assert.deepEqual(comparisons.find((c) => c.entity === "samples")?.extra, ["sx"]);
});

test("field mismatch: изменённое поле помечается суффиксом ~", async () => {
  const { ctx, memory } = makeCtx();
  const dump = await importStandard(memory, "rw4");

  const rows = memory.table("fact");
  const f1 = rows.find((r) => (r as { legacyId?: string }).legacyId === "f1") as Record<string, unknown>;
  f1.title = "Подмена";
  const { comparisons, match } = await reconcileReads(ctx, dump);
  assert.equal(match, false);
  assert.deepEqual(comparisons.find((c) => c.entity === "facts")?.missing, ["f1~"]);
});

test("deleted on one side: удалённый образец — missing", async () => {
  const { ctx, memory } = makeCtx();
  const dump = await importStandard(memory, "rw5");

  await deleteSample(wctx(ctx), "s1");
  const { match, comparisons } = await reconcileReads(ctx, dump);
  assert.equal(match, false);
  assert.deepEqual(comparisons.find((c) => c.entity === "samples")?.missing, ["s1"]);
});

test("cross-org: строка чужой организации невидима в сверке", async () => {
  const { ctx, memory } = makeCtx();
  const dump = await importStandard(memory, "rw6");

  memory.table("purchase").push({
    id: "pg-alien",
    organizationId: ORG_B,
    legacyId: "pa",
    originalFormatVersion: 2,
    status: "draft",
    payload: { subject: "Чужая" },
  });
  const { match, comparisons } = await reconcileReads(ctx, dump);
  assert.equal(match, true, "чужие строки не участвуют в сверке");
  assert.deepEqual(comparisons.find((c) => c.entity === "purchases")?.extra, []);
});

test("duplicate legacy identity: дубль виден в duplicates", async () => {
  const { ctx, memory } = makeCtx();
  await importStandard(memory, "rw7");

  const rows = memory.table("purchase");
  const victim = rows.find((r) => (r as { legacyId?: string }).legacyId === "pa") as Record<string, unknown>;
  rows.push({ ...victim, id: "pg-duplicate" });
  const dump = JSON.parse(standardBackupJson()) as unknown as Dump;
  const { comparisons } = await reconcileReads(ctx, dump);
  assert.deepEqual(comparisons.find((c) => c.entity === "purchases")?.duplicates, ["pa"]);
});

