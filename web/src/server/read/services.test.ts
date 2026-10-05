/**
 * Модульные проверки server read services S4 на in-memory БД.
 *
 * Изоляция арендаторов — на каждом пути чтения: чужой скоуп не видит и не
 * меняет ничего; без членства чтение отклоняется. Формы сверяются с legacy:
 * закупка — `{...payload, id}`, факт — shaping `readFact`, профиль — сборка
 * из двух таблиц, документы/образцы — только метаданные без текстов.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { withRunner } from "../auth/transaction.ts";
import { createMemoryDb } from "../auth/testing/memory-db.ts";
import type { MemoryDb } from "../auth/testing/memory-db.ts";
import { orgScope } from "../db/org-scope.ts";
import { runLegacyImport } from "../import/pipeline.ts";
import { standardBackupJson } from "../import/testing/fixtures.ts";
import {
  assembleProfile,
  DuplicateLegacyIdError,
  getPurchase,
  listDocuments,
  listFacts,
  listPurchases,
  listSamples,
  readProfile,
  shapeFact,
  type ReadContext,
} from "./services.ts";

const ORG_A = "ca00000000000000000001";
const ORG_B = "cb00000000000000000001";
const U1 = "cu10000000000000000001";

function makeCtx(): { memory: MemoryDb; ctx: ReadContext; foreign: ReadContext } {
  const memory = createMemoryDb();
  memory.table("membership").push({ organizationId: ORG_A, userId: U1 });
  const db = memory.db;
  const scope = orgScope(ORG_A);
  return {
    memory,
    ctx: { db, scope, userId: U1 },
    foreign: { db, scope: orgScope(ORG_B), userId: U1 },
  };
}

async function importStandard(memory: MemoryDb): Promise<void> {
  const db = memory.db;
  await runLegacyImport({
    db,
    run: withRunner(db),
    scope: orgScope(ORG_A),
    userId: U1,
    raw: standardBackupJson(),
    batchKey: `read-${Math.random().toString(36).slice(2)}`,
  });
}

test("listPurchases отдаёт доменную форму с legacy-идентичностью", async () => {
  const { ctx, memory } = makeCtx();
  await importStandard(memory);
  const list = await listPurchases(ctx);

  assert.equal(list.length, 4);
  const ids = list.map((p) => p.id).sort();
  assert.deepEqual(ids, ["pa", "pb", "pc", "pd"]);
  const pa = list.find((p) => p.id === "pa");
  assert.equal(pa?.subject, "Поставка зала");
  assert.equal(pa?.tpPrice, 1200000);
});

test("getPurchase: legacyId, id строки, чужой скоуп, дубли", async () => {
  const { ctx, foreign, memory } = makeCtx();
  await importStandard(memory);
  memory.table("membership").push({ organizationId: ORG_B, userId: U1 });

  assert.equal((await getPurchase(ctx, "pa"))?.id, "pa");
  assert.equal(await getPurchase(ctx, "nope"), null, "нет записи — null, а не исключение");
  assert.equal(await getPurchase(foreign, "pa"), null, "участник чужой организации не видит запись");

  const rows = memory.table("purchase");
  const victim = rows.find((r) => (r as { legacyId?: string }).legacyId === "pa") as Record<string, unknown>;
  rows.push({ ...victim, id: "pg-duplicate" });
  await assert.rejects(() => getPurchase(ctx, "pa"), DuplicateLegacyIdError, "дубль legacyId — явный отказ");

  rows.splice(rows.findIndex((r) => (r as { id?: string }).id === "pg-duplicate"), 1);
  const lone = { id: "pg-lone", organizationId: ORG_A, legacyId: null, originalFormatVersion: 2, status: "draft", payload: { subject: "Без legacy" } };
  rows.push(lone);
  assert.equal((await getPurchase(ctx, "pg-lone"))?.id, "pg-lone", "строка без legacyId читается по id");
});

test("listDocuments: только метаданные, чужая закупка — пусто", async () => {
  const { ctx, foreign, memory } = makeCtx();
  await importStandard(memory);
  memory.table("membership").push({ organizationId: ORG_B, userId: U1 });

  const docs = await listDocuments(ctx, "pa");
  assert.equal(docs.length, 2);
  assert.equal(docs[0].name, "ТЗ.pdf");
  assert.equal(docs[0].text, null, "без S6 текст не выдумывается");
  assert.equal(docs[0].map, null);
  assert.equal(docs[0].textStatus, "missing");
  assert.ok((docs[0].sha256?.length ?? 0) === 64);

  assert.deepEqual(await listDocuments(ctx, "nope"), [], "нет закупки — пусто, а не чужие документы");
  assert.deepEqual(await listDocuments(foreign, "pa"), [], "чужой скоуп — пусто");
});

test("listFacts: форма legacy-чтения, неизвестный вид отбрасывается", async () => {
  const { ctx, memory } = makeCtx();
  await importStandard(memory);

  const facts = await listFacts(ctx);
  assert.equal(facts.length, 2);
  const f1 = facts.find((f) => f.id === "f1") as unknown as Record<string, unknown>;
  assert.equal(f1.confirmed, true);
  assert.deepEqual(f1.answers, ["зал от 150 мест"]);

  memory.table("fact").push({
    id: "pg-weird",
    organizationId: ORG_A,
    legacyId: "weird",
    kind: "nope",
    title: "Чужой вид",
    fields: {},
    measures: [],
    validity: {},
    source: {},
    origin: "human",
    confirmed: true,
    answers: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const after = await listFacts(ctx);
  assert.equal(after.length, 2, "неизвестный вид не читается — как в legacy");
  assert.equal(shapeFact({ kind: "nope", legacyId: "x", id: "y" }), null);
});

test("listSamples: полная форма MyDocument; без S6 текст не выдумывается", async () => {
  const { ctx, memory } = makeCtx();
  await importStandard(memory);

  const samples = await listSamples(ctx);
  assert.equal(samples.length, 2);
  const s1 = samples.find((s) => s.id === "s1");
  assert.deepEqual(s1?.kinds, ["tp"]);
  assert.equal(s1?.name, "ТП-образец.pdf", "имя восстановлено из копии (S11-R0)");
  assert.equal(s1?.addedAt, "2026-09-01T10:00:00.000Z", "историческая дата не заменена");
  assert.equal(s1?.about, "Образец ТП");
  // Без хранилища текст не переносится — это явное состояние `missing`.
  assert.ok(samples.every((s) => s.text === null && s.map === null && s.textStatus === "missing"));
});

test("readProfile: сборка из двух таблиц; без членства — отказ", async () => {
  const { ctx, memory } = makeCtx();
  await importStandard(memory);

  const { profile, meta, userId } = await readProfile(ctx);
  assert.equal(userId, U1);
  assert.equal(profile.fullName, "ООО Ромашка");
  assert.equal(profile.head, "Иванов И. И.");
  assert.equal(meta.version, 1);

  const alien = await readProfile({ ...ctx, userId: "cu99999999999999999999" }).catch(() => null);
  assert.equal(alien, null, "без членства чтение отклоняется");
});

test("readProfile чужой организации не видит чужие реквизиты", async () => {
  const { memory } = makeCtx();
  await importStandard(memory);
  memory.table("membership").push({ organizationId: ORG_B, userId: U1 });
  const ctxB = { db: memory.db, scope: orgScope(ORG_B), userId: U1 };

  const { profile } = await readProfile(ctxB);
  assert.equal(profile.fullName, "", "в чужой организации своих реквизитов нет — пустой профиль, а не чужие данные");
});

test("без членства чтение отклоняется на каждом пути", async () => {
  const { memory } = makeCtx();
  await importStandard(memory);
  const stranger = { db: memory.db, scope: orgScope(ORG_A), userId: "cu99999999999999999999" };

  await assert.rejects(() => listPurchases(stranger), /NotFoundInScopeError/);
  await assert.rejects(() => getPurchase(stranger, "pa"), /NotFoundInScopeError/);
  await assert.rejects(() => listDocuments(stranger, "pa"), /NotFoundInScopeError/);
  await assert.rejects(() => listFacts(stranger), /NotFoundInScopeError/);
  await assert.rejects(() => listSamples(stranger), /NotFoundInScopeError/);
  await assert.rejects(() => readProfile(stranger), /NotFoundInScopeError/);
});

test("assembleProfile: приоритет организации, неизвестные ключи отбрасываются", () => {
  const { profile, substituted } = assembleProfile(
    { fullName: "ООО", inn: "1", junk: "x" },
    { fullName: "Петров", head: "П.", junk2: "y", phone: 42 },
  );
  assert.equal(profile.fullName, "ООО", "приоритет организации");
  assert.deepEqual(substituted, ["fullName"]);
  assert.equal(profile.head, "П.");
  assert.ok(!("junk" in profile) && !("junk2" in profile), "неизвестные ключи не попадают в профиль");
});
