/**
 * S11-R0: authoritative server read/write model for content and profile metadata.
 *
 * Проверяет round-trip через S6-абстракцию (`memoryStorage`): текст и карта
 * документа, полная форма `MyDocument` (имя, дата, скан, текст, карта),
 * `ProfileMeta` (sources/suggestions). Хранилище подменено на in-memory —
 * второго storage implementation в коде не появляется.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { withRunner } from "../auth/transaction.ts";
import { createMemoryDb } from "../auth/testing/memory-db.ts";
import type { MemoryDb } from "../auth/testing/memory-db.ts";
import { orgScope } from "../db/org-scope.ts";
import { listDocuments, listSamples, readProfile, type ReadContext } from "../read/services.ts";
import { memoryStorage } from "../storage/testing/memory-storage.ts";
import type { StorageAdapter } from "../storage/types.ts";
import { replacePurchaseDocuments, replaceSample, saveServerProfile, type WriteContext } from "./services.ts";

const ORG_A = "ca00000000000000000001";
const U1 = "cu10000000000000000001";

function makeCtx(): { memory: MemoryDb; ctx: WriteContext; read: ReadContext; storage: StorageAdapter } {
  const memory = createMemoryDb();
  memory.table("membership").push({ organizationId: ORG_A, userId: U1 });
  const db = memory.db;
  const scope = orgScope(ORG_A);
  const storage = memoryStorage();
  return {
    memory,
    storage,
    ctx: { db, run: withRunner(db), scope, userId: U1, storage },
    read: { db, scope, userId: U1, storage },
  };
}

const purchase = (id: string) => ({ id, subject: "Закупка", createdAt: "2026-09-20T10:00:00.000Z", files: [], unreadable: [], requirements: {} });

const MAP = { spans: [{ from: 0, to: 4, page: 1 }, { from: 4, to: 8, table: 1, row: 1, col: 1 }] };

test("Document.text и Document.map читаются обратно из S6", async () => {
  const { ctx, read } = makeCtx();

  await replacePurchaseDocuments(ctx, "p1", {
    purchase: purchase("p1"),
    documents: [{ name: "ТЗ.pdf", text: "зал на 150 мест", scan: true, map: MAP }],
  });

  const docs = await listDocuments(read, "p1");
  assert.equal(docs.length, 1);
  assert.equal(docs[0].text, "зал на 150 мест");
  assert.deepEqual(docs[0].map, MAP);
  assert.equal(docs[0].textStatus, "available");
  assert.equal(docs[0].scan, true);
});

test("без S6 содержимое не выдумывается: textStatus missing, ключей нет", async () => {
  const { memory } = makeCtx();
  const db = memory.db;
  const scope = orgScope(ORG_A);
  const bare: WriteContext = { db, run: withRunner(db), scope, userId: U1 };

  await replacePurchaseDocuments(bare, "p1", {
    purchase: purchase("p1"),
    documents: [{ name: "ТЗ.pdf", text: "зал", map: MAP }],
  });

  const read: ReadContext = { db, scope, userId: U1 };
  const docs = await listDocuments(read, "p1");
  assert.equal(docs[0].text, null);
  assert.equal(docs[0].map, null);
  assert.equal(docs[0].textStatus, "missing");
});

test("MyDocument: name/addedAt/scan/text/map round-trip", async () => {
  const { ctx, read } = makeCtx();

  await replaceSample(ctx, "s1", {
    id: "s1",
    name: "ТП.pdf",
    text: "образец",
    addedAt: "2026-09-01T10:00:00.000Z",
    kinds: ["tp"],
    about: "ТП прошлого года",
    scan: true,
    map: MAP,
  });

  const samples = await listSamples(read);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].name, "ТП.pdf");
  assert.equal(samples[0].addedAt, "2026-09-01T10:00:00.000Z");
  assert.equal(samples[0].scan, true);
  assert.equal(samples[0].text, "образец");
  assert.deepEqual(samples[0].map, MAP);
  assert.equal(samples[0].textStatus, "available");
  assert.deepEqual(samples[0].kinds, ["tp"]);
});

test("replaceSample заменяет содержимое: старый mapKey не остаётся", async () => {
  const { ctx, read } = makeCtx();
  await replaceSample(ctx, "s1", { id: "s1", name: "A.pdf", text: "a", addedAt: "2026-09-01T10:00:00.000Z", kinds: ["tp"], about: "", map: MAP });

  await replaceSample(ctx, "s1", { id: "s1", name: "B.pdf", text: "b", addedAt: "2026-09-02T10:00:00.000Z", kinds: ["tp"], about: "" });
  const samples = await listSamples(read);
  assert.equal(samples[0].text, "b");
  assert.equal(samples[0].map, null, "новая запись без карты не читает старую карту");
  assert.equal(samples[0].name, "B.pdf");
});

test("ProfileMeta: version + sources + suggestions round-trip и обновление", async () => {
  const { ctx, read } = makeCtx();

  await saveServerProfile(ctx, {
    profile: { fullName: "ООО Ромашка", inn: "7700000000" },
    meta: { sources: { inn: "Анкета.pdf" }, suggestions: [{ key: "kpp", value: "1", source: "Анкета.pdf" }] },
  });

  const first = await readProfile(read);
  assert.equal(first.meta.version, 1);
  assert.equal(first.meta.sources.inn, "Анкета.pdf");
  assert.deepEqual(first.meta.suggestions, [{ key: "kpp", value: "1", source: "Анкета.pdf" }]);

  await saveServerProfile(ctx, {
    profile: { fullName: "ООО Ромашка", inn: "7700000000" },
    meta: { sources: { inn: "Новая анкета.pdf" }, suggestions: [] },
  });

  const second = await readProfile(read);
  assert.equal(second.meta.sources.inn, "Новая анкета.pdf", "метаданные обновляются вместе с профилем");
  assert.deepEqual(second.meta.suggestions, []);
});
