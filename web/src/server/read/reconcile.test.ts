/**
 * Read reconciliation S4: копия IndexedDB против серверного чтения.
 *
 * Дополнительно фиксирует равенство серверной формы legacy-читателям:
 * `listFacts` ≡ `readFact`, `listSamples` ≡ `readMyDocument` по видам,
 * профиль ≡ `EMPTY_PROFILE + fromStore`. Storage-модули импортируются только
 * здесь, в тесте, — production-путь их не касается.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { parseBackup, type Dump } from "@/lib/backup-format";
import { fromStore } from "@/lib/data-format";
import { readFact } from "@/lib/evidence-store";
import { readMyDocument } from "@/lib/me-store";
import { EMPTY_PROFILE, PROFILE_KEYS } from "@/lib/profile";
import { withRunner } from "../auth/transaction.ts";
import { createMemoryDb } from "../auth/testing/memory-db.ts";
import { orgScope } from "../db/org-scope.ts";
import { runLegacyImport } from "../import/pipeline.ts";
import { standardBackupJson } from "../import/testing/fixtures.ts";
import { reconcileReads } from "./reconcile.ts";
import { listFacts, listPurchases, listSamples, readProfile } from "./services.ts";

const ORG_A = "ca00000000000000000001";
const U1 = "cu10000000000000000001";

async function importedCtx() {
  const memory = createMemoryDb();
  memory.table("membership").push({ organizationId: ORG_A, userId: U1 });
  const db = memory.db;
  const scope = orgScope(ORG_A);
  await runLegacyImport({ db, run: withRunner(db), scope, userId: U1, raw: standardBackupJson(), batchKey: `rec-${Math.random().toString(36).slice(2)}` });
  const dump = (parseBackup(JSON.parse(standardBackupJson())) as { ok: true; dump: Dump }).dump;
  return { memory, ctx: { db, scope, userId: U1 }, dump };
}

test("сверка импортированной копии с серверным чтением сходится", async () => {
  const { ctx, dump } = await importedCtx();
  const { comparisons, match } = await reconcileReads(ctx, dump);

  assert.equal(match, true);
  for (const c of comparisons) {
    assert.equal(c.checksumMatch, true, `${c.entity}: checksum сошёлся`);
    assert.deepEqual(c.missing, [], `${c.entity}: нет missing`);
    assert.deepEqual(c.extra, [], `${c.entity}: нет extra`);
  }
  const byEntity = new Map(comparisons.map((c) => [c.entity, c]));
  assert.equal(byEntity.get("purchases")?.sourceCount, 4);
  assert.equal(byEntity.get("documents")?.sourceCount, 4);
  assert.equal(byEntity.get("profile")?.sourceCount, 1);
});

test("расхождение сервера с копией видно поименно", async () => {
  const { ctx, dump, memory } = await importedCtx();
  const rows = memory.table("purchase");
  const victim = rows.find((r) => (r as { legacyId?: string }).legacyId === "pa") as Record<string, unknown>;
  (victim.payload as Record<string, unknown>).subject = "Подмена";

  const { comparisons, match } = await reconcileReads(ctx, dump);
  assert.equal(match, false);
  const purchases = comparisons.find((c) => c.entity === "purchases");
  assert.ok(purchases?.missing.some((m) => m.startsWith("pa")), "изменённая запись помечена");
});

test("удалённая на сервере строка видна как missing", async () => {
  const { ctx, dump, memory } = await importedCtx();
  const rows = memory.table("fact");
  rows.splice(rows.findIndex((r) => (r as { legacyId?: string }).legacyId === "f1"), 1);

  const { comparisons, match } = await reconcileReads(ctx, dump);
  assert.equal(match, false);
  assert.deepEqual(comparisons.find((c) => c.entity === "facts")?.missing, ["f1"]);
});

test("пустой сервер — полное расхождение, а не тишина", async () => {
  const memory = createMemoryDb();
  memory.table("membership").push({ organizationId: ORG_A, userId: U1 });
  const ctx = { db: memory.db, scope: orgScope(ORG_A), userId: U1 };
  const dump = (parseBackup(JSON.parse(standardBackupJson())) as { ok: true; dump: Dump }).dump;

  const { comparisons, match } = await reconcileReads(ctx, dump);
  assert.equal(match, false);
  assert.ok(comparisons.every((c) => c.missing.length > 0 || c.sourceCount === 0));
});

test("серверная форма фактов равна legacy readFact на тех же данных", async () => {
  const { ctx, dump } = await importedCtx();
  const server = await listFacts(ctx);
  const legacy = dump.facts.map((raw) => readFact(raw)).filter((f) => f !== null);
  const byId = (list: { id: string }[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(
    byId(server as unknown as { id: string }[]),
    byId(legacy),
    "серверные факты совпадают с браузерным чтением",
  );
});

test("серверные образцы повторяют правило видов readMyDocument", async () => {
  const { ctx, dump } = await importedCtx();
  const server = await listSamples(ctx);
  const legacy = dump.samples.map((raw) => readMyDocument(raw));
  assert.deepEqual(
    server.map((s) => s.kinds).sort(),
    legacy.map((d) => d.kinds).sort(),
  );
});

test("серверный профиль равен браузерному getProfile минус отброшенные неизвестные ключи", async () => {
  const { ctx, dump } = await importedCtx();
  const { profile } = await readProfile(ctx);
  const stored = dump.settings.find(([key]) => key === "profile")?.[1];
  const migrated = fromStore<Record<string, unknown>>("profile", stored);
  const known: Record<string, unknown> = {};
  for (const key of PROFILE_KEYS) {
    if (key in migrated) {
      known[key] = migrated[key];
    }
  }
  assert.deepEqual(profile, { ...EMPTY_PROFILE, ...known });
});

test("серверные закупки равны fromStore-представлению копии", async () => {
  const { ctx, dump } = await importedCtx();
  const server = await listPurchases(ctx);
  const legacy = dump.purchases.map((raw) => fromStore<Record<string, unknown>>("purchase", raw));
  assert.deepEqual(
    server.map((p) => (p as unknown as Record<string, unknown>).subject).sort(),
    legacy.map((p) => p.subject as string).sort(),
  );
});
