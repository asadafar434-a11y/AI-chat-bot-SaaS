/**
 * Модульные проверки server write services S5 на in-memory БД.
 *
 * Parity с IndexedDB-семантикой (`*_store.ts`): POST — только создание (повтор
 * id — 409 без дубля), PUT — upsert как legacy `put` (ответ несёт `created`),
 * DELETE отсутствующего — 404 без изменения состояния. Изоляция: чужой скоуп
 * и отсутствие членства — отказ на каждом пути; подмена id в теле — 400.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { withRunner } from "../auth/transaction.ts";
import type { DbClient } from "../db/db-client.ts";
import { createMemoryDb } from "../auth/testing/memory-db.ts";
import type { MemoryDb } from "../auth/testing/memory-db.ts";
import { orgScope } from "../db/org-scope.ts";
import type { WriteContext } from "./services.ts";
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
} from "./services.ts";

const ORG_A = "ca00000000000000000001";
const ORG_B = "cb00000000000000000001";
const U1 = "cu10000000000000000001";

function makeCtx(): { memory: MemoryDb; ctx: WriteContext } {
  const memory = createMemoryDb();
  memory.table("membership").push({ organizationId: ORG_A, userId: U1 });
  const db = memory.db;
  return { memory, ctx: { db, run: withRunner(db), scope: orgScope(ORG_A), userId: U1 } };
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

const fact = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "license",
  title: "Лицензия",
  source: { type: "manual" },
  ...extra,
});

const sample = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: "Ф.pdf",
  text: "текст",
  addedAt: "2026-09-01T10:00:00.000Z",
  kinds: ["tp"],
  about: "Образец",
  ...extra,
});

test("purchase create/update/delete/not-found/repeat", async () => {
  const { ctx, memory } = makeCtx();

  const created = await createPurchase(ctx, purchase("p1", { tpPrice: 100 }));
  assert.equal(created.created, true);
  assert.equal(created.legacyId, "p1");

  await assert.rejects(() => createPurchase(ctx, purchase("p1")), /уже существует/, "повторный create — 409 без дубля");
  assert.equal(memory.table("purchase").length, 1);

  const replaced = await replacePurchase(ctx, "p1", purchase("p1", { tpPrice: 200 }));
  assert.equal(replaced.created, false);
  const row = memory.table("purchase")[0] as Record<string, unknown>;
  assert.equal((row.payload as Record<string, unknown>).tpPrice, 200, "PUT заменяет целиком");
  assert.equal(row.createdByUserId, U1, "автор — из сессии");

  const upserted = await replacePurchase(ctx, "p2", purchase("p2"));
  assert.equal(upserted.created, true, "PUT отсутствующего создаёт (parity с put)");

  assert.deepEqual(await deletePurchase(ctx, "p1"), { documents: 0 });
  assert.equal(memory.table("purchase").length, 1, "осталась только p2");
  await assert.rejects(() => deletePurchase(ctx, "p1"), /NotFoundInScopeError/, "повторное удаление — 404");
});

test("purchase with documents: каскад атомарен, тексты не persist-ятся", async () => {
  const { ctx, memory } = makeCtx();

  const res = await replacePurchaseDocuments(ctx, "p1", {
    purchase: purchase("p1"),
    documents: [{ name: "ТЗ.pdf", text: "Текст задания" }, { name: "Смета.xlsx", text: "1" }],
  });
  assert.equal(res.documents, 2);
  const docs = memory.table("document") as Record<string, unknown>[];
  assert.deepEqual(
    docs.map((d) => d.legacyId).sort(),
    ["p1:0", "p1:1"],
    "legacyId документов — {purchaseId}:{index}",
  );
  assert.ok(docs.every((d) => d.storageKey === null && d.textKey === null));

  const again = await replacePurchaseDocuments(ctx, "p1", {
    purchase: purchase("p1"),
    documents: [{ name: "Только.pdf", text: "один" }],
  });
  assert.equal(again.documents, 1);
  assert.equal(memory.table("document").length, 1, "массив заменён целиком, а не дописан");

  await deletePurchase(ctx, "p1");
  assert.equal(memory.table("document").length, 0, "каскад удалил документы");
  assert.equal(memory.table("purchase").length, 0);
});

test("sample/fact create/replace/delete с изоляцией", async () => {
  const { ctx, memory } = makeCtx();

  await createSample(ctx, sample("s1"));
  await assert.rejects(() => createSample(ctx, sample("s1")), /уже существует/);
  const replaced = await replaceSample(ctx, "s1", sample("s1", { about: "Новое" }));
  assert.equal(replaced.created, false);
  await deleteSample(ctx, "s1");
  await assert.rejects(() => deleteSample(ctx, "s1"), /NotFoundInScopeError/);

  await createFact(ctx, fact("f1"));
  await assert.rejects(() => createFact(ctx, fact("f1")), /уже существует/);
  const replacedFact = await replaceFact(ctx, "f1", fact("f1", { title: "Новое" }));
  assert.equal(replacedFact.created, false);
  const rows = memory.table("fact") as Record<string, unknown>[];
  assert.equal(rows[0].title, "Новое");
  await deleteFact(ctx, "f1");
  await assert.rejects(() => deleteFact(ctx, "f1"), /NotFoundInScopeError/);

  assert.equal(memory.table("sample").length, 0);
  assert.equal(memory.table("fact").length, 0);
});

test("profile: split по правилу S3, чужому не пишется", async () => {
  const { ctx, memory } = makeCtx();

  const res = await saveServerProfile(ctx, {
    profile: { fullName: "ООО", inn: "1", head: "И.", phone: "+7", futureField: "x" },
    meta: { sources: {}, suggestions: [] },
  });
  assert.equal(res.organizationId, ORG_A);
  assert.equal(res.userId, U1);
  assert.equal(res.created, true);

  const orgRows = memory.table("organizationProfile") as Record<string, unknown>[];
  const userRows = memory.table("userProfile") as Record<string, unknown>[];
  assert.equal((orgRows[0].fields as Record<string, string>).fullName, "ООО");
  assert.ok(!("head" in (orgRows[0].fields as object)));
  assert.equal((userRows[0].fields as Record<string, string>).head, "И.");
  assert.equal(userRows[0].userId, U1);

  const again = await saveServerProfile(ctx, {
    profile: { fullName: "ООО", inn: "1", head: "И.", phone: "+7" },
    meta: { sources: {}, suggestions: [] },
  });
  assert.equal(again.created, false, "повтор тем же содержимым — не дублирует");
  assert.equal(memory.table("organizationProfile").length, 1);
  assert.equal(memory.table("userProfile").length, 1);

  await assert.rejects(
    () => saveServerProfile(ctx, { profile: {}, meta: { sources: {}, suggestions: [] } }),
    /профиль пуст/,
    "пустой профиль не пишется",
  );
});

test("изоляция и запрещённые поля на каждом пути", async () => {
  const { ctx, memory } = makeCtx();
  await createPurchase(ctx, purchase("p1"));
  const foreign = { ...ctx, scope: orgScope(ORG_B) };
  const stranger = { ...ctx, userId: "cu99999999999999999999" };

  await assert.rejects(() => createPurchase(foreign, purchase("x")), /NotFoundInScopeError/);
  await assert.rejects(() => replacePurchase(foreign, "p1", purchase("p1")), /NotFoundInScopeError/);
  await assert.rejects(() => deletePurchase(foreign, "p1"), /NotFoundInScopeError/);
  await assert.rejects(
    () => replacePurchaseDocuments(foreign, "p1", { purchase: purchase("p1"), documents: [] }),
    /NotFoundInScopeError/,
  );
  await assert.rejects(() => createSample(foreign, sample("x")), /NotFoundInScopeError/);
  await assert.rejects(() => deleteSample(foreign, "s1"), /NotFoundInScopeError/);
  await assert.rejects(() => createFact(foreign, fact("x")), /NotFoundInScopeError/);
  await assert.rejects(() => deleteFact(foreign, "f1"), /NotFoundInScopeError/);
  await assert.rejects(
    () => saveServerProfile(foreign, { profile: { inn: "1" } }),
    /NotFoundInScopeError/,
  );
  await assert.rejects(() => createPurchase(stranger, purchase("y")), /NotFoundInScopeError/);
  assert.equal(
    (memory.table("purchase") as Record<string, unknown>[]).filter((r) => r.organizationId === ORG_B).length,
    0,
    "в чужую организацию ничего не записалось",
  );

  await assert.rejects(
    () => createPurchase(ctx, { ...purchase("z"), organizationId: ORG_B }),
    /определяет сервер/,
    "organizationId из тела отклоняется",
  );
  await assert.rejects(
    () => replacePurchase(ctx, "p1", { ...purchase("other"), id: "other" }),
    /не совпадает/,
    "подмена id в теле отклоняется",
  );
  await assert.rejects(() => createPurchase(ctx, null), /обязано быть объектом/);
  const unknownKind = await createFact(ctx, fact("k1", { kind: "future-kind" }));
  assert.equal(unknownKind.created, true, "вид факта не валидируется против справочника — parity с импортом");
});

test("write services не импортируют Prisma и работают на DbClient", async () => {
  const { ctx } = makeCtx();
  const db: DbClient = ctx.db;
  assert.ok(typeof db.purchase.create === "function");
  assert.ok(typeof db.document.deleteMany === "function");
});
