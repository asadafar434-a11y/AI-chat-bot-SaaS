/**
 * P1: серверное «Удалить все мои данные».
 *
 * Проверяет: owner удаляет данные организации + личные; member — только личные,
 * не трогая общие данные; чужой tenant недоступен; объекты S6 удаляются; событие
 * пишется в S7 audit; журнал/членство/приглашения не удаляются.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { withRunner } from "../auth/transaction.ts";
import { createMemoryDb } from "../auth/testing/memory-db.ts";
import type { MemoryDb } from "../auth/testing/memory-db.ts";
import { orgScope } from "../db/org-scope.ts";
import { memoryStorage } from "../storage/testing/memory-storage.ts";
import type { StorageAdapter } from "../storage/types.ts";
import { wipeTenantData, type WipeResult } from "./wipe.ts";
import type { WriteContext } from "./services.ts";

const ORG_A = "ca00000000000000000001";
const ORG_B = "cb00000000000000000001";
const OWNER_A = "cu10000000000000000001";
const MEMBER_A = "cu10000000000000000002";
const OWNER_B = "cu20000000000000000001";

const KEY = (org: string, kind: "doc" | "sample", id: string, n: string) => `org/${org}/${kind}/${id}/${n}`;

type Seeded = { memory: MemoryDb; storage: StorageAdapter; ctx: WriteContext };

function seedOrg(memory: MemoryDb, storage: StorageAdapter, org: string, userId: string, tag: string): void {
  const docKey = KEY(org, "doc", `d-${tag}`, "0".repeat(32));
  const docTextKey = KEY(org, "doc", `d-${tag}`, "1".repeat(32));
  const docMapKey = KEY(org, "doc", `d-${tag}`, "2".repeat(32));
  const sampleTextKey = KEY(org, "sample", `s-${tag}`, "3".repeat(32));
  const sampleMapKey = KEY(org, "sample", `s-${tag}`, "4".repeat(32));
  for (const key of [docKey, docTextKey, docMapKey, sampleTextKey, sampleMapKey]) {
    void storage.putObject(key, new TextEncoder().encode("x"));
  }
  memory.table("purchase").push({ id: `p-${tag}`, organizationId: org, legacyId: `p-${tag}`, status: "draft", payload: {} });
  memory.table("document").push({
    id: `d-${tag}`,
    organizationId: org,
    purchaseId: `p-${tag}`,
    storageKey: docKey,
    textKey: docTextKey,
    mapKey: docMapKey,
  });
  memory.table("sample").push({ id: `s-${tag}`, organizationId: org, textKey: sampleTextKey, mapKey: sampleMapKey });
  memory.table("fact").push({ id: `f-${tag}`, organizationId: org, kind: "license", title: "Л", confirmed: true });
  memory.table("organizationProfile").push({ id: `op-${tag}`, organizationId: org, fields: {}, version: 1, meta: {} });
  memory.table("userProfile").push({ id: `up-${tag}`, userId, fields: { inn: "1" }, version: 1 });
  memory.table("auditEvent").push({ id: `ae-${tag}`, organizationId: org, action: "purchase.created", entityType: "purchase", entityId: `p-${tag}` });
}

function makeSeeded(): Seeded {
  const memory = createMemoryDb();
  const storage = memoryStorage();
  memory.table("membership").push({ organizationId: ORG_A, userId: OWNER_A, role: "owner" });
  memory.table("membership").push({ organizationId: ORG_A, userId: MEMBER_A, role: "member" });
  memory.table("membership").push({ organizationId: ORG_B, userId: OWNER_B, role: "owner" });
  memory.table("invitation").push({ id: "inv-a", organizationId: ORG_A, email: "x@example.test", role: "member", expiresAt: new Date() });
  memory.table("legacyImportBatch").push({ id: "lib-a", organizationId: ORG_A, batchKey: "b", backupHash: "h", status: "completed" });
  seedOrg(memory, storage, ORG_A, OWNER_A, "a");
  seedOrg(memory, storage, ORG_B, OWNER_B, "b");
  const db = memory.db;
  return { memory, storage, ctx: { db, run: withRunner(db), scope: orgScope(ORG_A), userId: OWNER_A, storage } };
}

const keysFor = (org: string, tag: string) => [
  KEY(org, "doc", `d-${tag}`, "0".repeat(32)),
  KEY(org, "sample", `s-${tag}`, "3".repeat(32)),
];

test("owner удаляет данные организации и личные; чужой tenant не тронут; объекты S6 удалены", async () => {
  const { memory, storage, ctx } = makeSeeded();
  const result = await wipeTenantData(ctx);

  assert.equal(result.scope, "organization");
  assert.deepEqual(
    { purchases: result.purchases, documents: result.documents, samples: result.samples, facts: result.facts },
    { purchases: 1, documents: 1, samples: 1, facts: 1 },
  );
  for (const table of ["purchase", "document", "sample", "fact", "organizationProfile", "userProfile"] as const) {
    const rows = memory.table(table).filter((r) => (r as { organizationId?: string; userId?: string }).organizationId === ORG_A || (r as { userId?: string }).userId === OWNER_A);
    assert.equal(rows.length, 0, `${table}: данные организации A удалены`);
  }
  for (const key of keysFor(ORG_A, "a")) {
    assert.equal(await storage.getObject(key), null, `объект ${key} удалён`);
  }

  // Чужой tenant (B) не тронут.
  assert.equal(memory.table("purchase").filter((r) => (r as { organizationId?: string }).organizationId === ORG_B).length, 1);
  assert.equal(memory.table("document").filter((r) => (r as { organizationId?: string }).organizationId === ORG_B).length, 1);
  assert.notEqual(await storage.getObject(keysFor(ORG_B, "b")[0]), null, "объект чужой организации цел");

  // Аудит: событие добавлено, прежний журнал не удалён.
  const audit = memory.table("auditEvent").filter((r) => (r as { organizationId?: string }).organizationId === ORG_A);
  assert.ok(audit.some((r) => (r as { action?: string }).action === "organization.wiped"));
  assert.ok(audit.some((r) => (r as { action?: string }).action === "purchase.created"), "журнал append-only");

  // Членство/приглашения/учёт переноса не удаляются.
  assert.equal(memory.table("membership").filter((r) => (r as { organizationId?: string }).organizationId === ORG_A).length, 2);
  assert.equal(memory.table("invitation").length, 1);
  assert.equal(memory.table("legacyImportBatch").length, 1);
});

test("member удаляет только личные данные, общие данные организации остаются", async () => {
  const { memory, storage, ctx } = makeSeeded();
  const result = await wipeTenantData({ ...ctx, userId: MEMBER_A });

  assert.equal(result.scope, "user");
  assert.equal(result.purchases, 0);
  // Общие данные организации A целы.
  for (const table of ["purchase", "document", "sample", "fact", "organizationProfile"] as const) {
    assert.equal(memory.table(table).filter((r) => (r as { organizationId?: string }).organizationId === ORG_A).length, 1, `${table} цел`);
  }
  assert.notEqual(await storage.getObject(keysFor(ORG_A, "a")[0]), null, "объекты S6 целы");
  // Личные данные member удалены; личные данные owner не тронуты.
  assert.equal(memory.table("userProfile").filter((r) => (r as { userId?: string }).userId === MEMBER_A).length, 0);
  assert.equal(memory.table("userProfile").filter((r) => (r as { userId?: string }).userId === OWNER_A).length, 1);
  const audit = memory.table("auditEvent").filter((r) => (r as { action?: string }).action === "user.data_wiped");
  assert.equal(audit.length, 1);
});

test("без членства wipe отклоняется и ничего не удаляет", async () => {
  const { memory, ctx } = makeSeeded();
  await assert.rejects(() => wipeTenantData({ ...ctx, userId: "cu99999999999999999999" }), /NotFoundInScopeError/);
  assert.equal(memory.table("purchase").filter((r) => (r as { organizationId?: string }).organizationId === ORG_A).length, 1);
});

test("участник чужой организации не может удалить данные этой организации", async () => {
  const { memory, ctx } = makeSeeded();
  const foreign: WriteContext = { ...ctx, scope: orgScope(ORG_B), userId: OWNER_A };
  await assert.rejects(() => wipeTenantData(foreign), /NotFoundInScopeError/);
  assert.equal(memory.table("purchase").filter((r) => (r as { organizationId?: string }).organizationId === ORG_B).length, 1);
});

test("результат типизирован (WipeResult) и содержит scope", async () => {
  const { ctx } = makeSeeded();
  const result: WipeResult = await wipeTenantData(ctx);
  assert.ok(result.scope === "organization" || result.scope === "user");
});
