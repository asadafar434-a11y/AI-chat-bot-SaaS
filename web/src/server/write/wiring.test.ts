/**
 * End-to-end проводка dual-write S5: НАСТОЯЩИЕ точки входа мутаций
 * (`savePurchase`, `saveMyDocuments`, …) выполняются против подменённых
 * IndexedDB (in-memory) и замокированного `fetch`.
 *
 * Доказывает фактический call graph, а не наличие файлов:
 * `UI/action → mutation function → dual (IndexedDB + POST/PUT/DELETE /api/writes)`.
 * Не покрыто здесь и не должно: `restoreBackup` (обратное направление) и
 * `wipeAll` (строго локальное удаление) — они сервер не вызывают никогда.
 */

import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import { FACT_SOURCE_KINDS, REQUISITE_KINDS } from "@/lib/my-docs";
import { deletePurchase, getPurchase, savePurchase, savePurchaseWithDocuments } from "@/lib/purchase-store";
import type { Purchase } from "@/lib/purchase";
import {
  deleteMyDocument,
  fillProfileFromDocuments,
  findFactsInDocuments,
  listMyDocuments,
  saveMyDocuments,
  saveProfile,
} from "@/lib/me-store";
import { deleteFact, listFacts, saveFacts } from "@/lib/evidence-store";
import type { Fact } from "@/lib/evidence-base";
import type { MyDocument } from "@/lib/me-store";
import { EMPTY_PROFILE } from "@/lib/profile";
import { DualWriteError } from "@/lib/server-writes";
import { installFakeIndexedDB, type FakeIndexedDb } from "@/lib/testing/fake-indexeddb.ts";

type Call = { url: string; method: string; body: unknown };

let idb: FakeIndexedDb;
let fetchCalls: Call[];
let previousFetch: typeof fetch | undefined;

function mockFetch(handler: (call: Call) => { status: number; body?: unknown }): void {
  fetchCalls = [];
  previousFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { method?: string; body?: string }) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? (JSON.parse(init.body) as unknown) : undefined,
    };
    fetchCalls.push(call);
    const res = handler(call);
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

const okFetch = () => mockFetch(() => ({ status: 200, body: { ok: true } }));

const purchase = (id: string, extra: Record<string, unknown> = {}): Purchase =>
  ({
    id,
    subject: "Закупка",
    createdAt: "2026-09-20T10:00:00.000Z",
    files: [],
    unreadable: [],
    requirements: {},
    ...extra,
  }) as unknown as Purchase;

before(() => {
  idb = installFakeIndexedDB();
  // Этот тест проверяет S5 dual-write и legacy-чтение IndexedDB; серверное чтение
  // (S11 cutover) проверяется отдельно в lib/cutover.test.ts.
  process.env.NEXT_PUBLIC_SERVER_READS = "0";
});

beforeEach(() => {
  idb.reset();
  process.env.NEXT_PUBLIC_SERVER_WRITES = "1";
  okFetch();
});

after(() => {
  idb.uninstall();
  if (previousFetch) {
    globalThis.fetch = previousFetch;
  }
  delete process.env.NEXT_PUBLIC_SERVER_WRITES;
  delete process.env.NEXT_PUBLIC_SERVER_READS;
});

test("purchase create/update: IndexedDB + PUT /api/writes/purchases/[id]", async () => {
  await savePurchase(purchase("p1", { tpPrice: 100 }));
  assert.equal(idb.rows("tender-lawyer", "purchases").length, 1);
  assert.deepEqual(
    fetchCalls.map((c) => `${c.method} ${c.url}`),
    ["PUT /api/writes/purchases/p1"],
  );
  assert.equal((fetchCalls[0].body as { purchase: Purchase }).purchase.tpPrice, 100);

  await savePurchase(purchase("p1", { tpPrice: 200 }));
  assert.equal(fetchCalls.length, 2, "обновление тоже идёт на сервер");
});

test("флаг выключен: только IndexedDB, fetch не вызывается", async () => {
  delete process.env.NEXT_PUBLIC_SERVER_WRITES;
  await savePurchase(purchase("p1"));
  const docs: MyDocument[] = [
    { id: "s1", name: "Ф.pdf", text: "t", addedAt: "2026-09-01", kinds: ["tp"], about: "" },
  ];
  await saveMyDocuments(docs);
  assert.equal(idb.rows("tender-lawyer", "purchases").length, 1);
  assert.equal(idb.rows("tender-lawyer-me", "samples").length, 1);
  assert.equal(fetchCalls.length, 0, "поведение побайтово legacy");
});

test("ошибка сервера не маскируется: legacy записан, бросается DualWriteError", async () => {
  mockFetch(() => ({ status: 500, body: "внутренняя ошибка" }));
  await assert.rejects(() => savePurchase(purchase("p1")), DualWriteError);
  assert.equal(idb.rows("tender-lawyer", "purchases").length, 1, "legacy-запись цела — расхождение увидит сверка");

  mockFetch(() => ({ status: 404, body: "Серверная запись выключена" }));
  await assert.rejects(() => savePurchase(purchase("p2")), (e: unknown) => {
    assert.ok(e instanceof DualWriteError);
    assert.equal(e.status, 404);
    return true;
  });
});

test("purchase delete: каскад в IndexedDB + DELETE на сервер; 404 сервера — сходимость", async () => {
  await savePurchaseWithDocuments(purchase("p1"), [{ name: "А.pdf", text: "t" }]);
  assert.equal(idb.rows("tender-lawyer", "documents").length, 1);
  assert.deepEqual(fetchCalls.map((c) => `${c.method} ${c.url}`), [
    "PUT /api/writes/purchases/p1/documents",
  ]);

  fetchCalls = [];
  await deletePurchase("p1");
  assert.equal(idb.rows("tender-lawyer", "purchases").length, 0);
  assert.equal(idb.rows("tender-lawyer", "documents").length, 0);
  assert.deepEqual(fetchCalls.map((c) => `${c.method} ${c.url}`), ["DELETE /api/writes/purchases/p1"]);

  mockFetch(() => ({ status: 404, body: "Не найдено" }));
  await deletePurchase("missing");
});

test("samples: save/delete идут и в IndexedDB, и на сервер", async () => {
  const docs: MyDocument[] = [
    { id: "s1", name: "А.pdf", text: "t1", addedAt: "2026-09-01", kinds: ["tp"], about: "" },
    { id: "s2", name: "Б.pdf", text: "t2", addedAt: "2026-09-02", kinds: ["tp"], about: "" },
  ];
  await saveMyDocuments(docs.map((d) => ({ ...d })));
  assert.equal(idb.rows("tender-lawyer-me", "samples").length, 2);
  assert.deepEqual(
    fetchCalls.map((c) => `${c.method} ${c.url}`),
    ["PUT /api/writes/samples/s1", "PUT /api/writes/samples/s2"],
  );

  fetchCalls = [];
  await deleteMyDocument("s1");
  assert.equal(idb.rows("tender-lawyer-me", "samples").length, 1);
  assert.deepEqual(fetchCalls.map((c) => `${c.method} ${c.url}`), ["DELETE /api/writes/samples/s1"]);
});

test("profile: saveProfile пишет обе стороны", async () => {
  await saveProfile(
    { ...EMPTY_PROFILE, fullName: "ООО", inn: "1", head: "И." },
    { sources: {}, suggestions: [] },
  );
  assert.equal(idb.rows("tender-lawyer-me", "settings").length, 2, "profile + profile-meta");
  assert.deepEqual(fetchCalls.map((c) => `${c.method} ${c.url}`), ["PUT /api/writes/profile"]);
});

test("fillProfileFromDocuments доходит до сервера через saveProfile", async () => {
  mockFetch((call) => {
    if (call.url === "/api/my-docs/profile") {
      return { status: 200, body: { fields: [{ key: "inn", value: "7700000000", source: "Ф.pdf" }], conflicts: [] } };
    }
    return { status: 200, body: { ok: true } };
  });
  const requisite: MyDocument[] = [
    { id: "d1", name: "Анкета.pdf", text: "ИНН 7700000000", addedAt: "2026-09-01", kinds: [REQUISITE_KINDS[0]], about: "" },
  ];
  await saveMyDocuments(requisite);
  fetchCalls = [];
  const { filled } = await fillProfileFromDocuments(await listMyDocuments());
  assert.deepEqual(filled, ["inn"]);
  assert.deepEqual(fetchCalls.map((c) => `${c.method} ${c.url}`), [
    "POST /api/my-docs/profile",
    "PUT /api/writes/profile",
  ]);
});

test("facts: saveFacts/deleteFact идут и в IndexedDB, и на сервер", async () => {
  const facts: Fact[] = [
    { id: "f1", kind: "license", title: "Л", fields: {}, measures: [], validity: {}, source: { type: "manual" }, origin: "human", confirmed: true, createdAt: "", updatedAt: "" },
  ];
  await saveFacts(facts);
  assert.equal(idb.rows("tender-lawyer-evidence", "facts").length, 1);
  assert.deepEqual(fetchCalls.map((c) => `${c.method} ${c.url}`), ["PUT /api/writes/facts/f1"]);

  fetchCalls = [];
  await deleteFact("f1");
  assert.equal((await listFacts()).length, 0);
  assert.deepEqual(fetchCalls.map((c) => `${c.method} ${c.url}`), ["DELETE /api/writes/facts/f1"]);
});

test("findFactsInDocuments доходит до сервера через saveFacts", async () => {
  mockFetch((call) => {
    if (call.url === "/api/my-docs/facts") {
      return {
        status: 200,
        body: {
          facts: [{ kind: "license", title: "Л", fields: {}, measures: [], validity: {}, source: { type: "document", docId: "d1", docName: "Лицензия.pdf", quote: "лицензия" }, origin: "ai", confirmed: false }],
          dropped: 0,
          issues: [],
        },
      };
    }
    return { status: 200, body: { ok: true } };
  });
  const pool: MyDocument[] = [
    { id: "d1", name: "Лицензия.pdf", text: "лицензия", addedAt: "2026-09-01", kinds: [FACT_SOURCE_KINDS[0]], about: "" },
  ];
  await saveMyDocuments(pool);
  fetchCalls = [];
  const report = await findFactsInDocuments(await listMyDocuments());
  assert.equal(report.added, 1);
  assert.ok(
    fetchCalls.some((c) => c.method === "PUT" && c.url.startsWith("/api/writes/facts/")),
    "найденные факты ушли на сервер",
  );
});

test("getPurchase чтения сервер не трогают", async () => {
  await savePurchase(purchase("p1"));
  fetchCalls = [];
  await getPurchase("p1");
  assert.equal(fetchCalls.length, 0, "чтение — без записи");
});
