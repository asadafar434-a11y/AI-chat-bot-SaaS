/**
 * S11 Final Read Cutover — production UI reads come from the server.
 *
 * These tests make IndexedDB unusable (or empty) and stub the server read endpoints,
 * then exercise the real production read entry points. A read that still depended on
 * IndexedDB would throw (blocked) or return empty (empty IDB) and fail here. No test
 * mocks IndexedDB data to make the UI look populated.
 *
 * The mutation test proves the cutover refresh sequence: mutation → server write →
 * notifyDataChanged → subscribers refetch server state.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";

import { onDataChanged } from "@/lib/data-events";
import { EMPTY_PROFILE, type Profile } from "@/lib/profile";
import type { Purchase } from "@/lib/purchase";
import type { Fact } from "@/lib/evidence-base";
import { listFacts } from "@/lib/evidence-store";
import { getProfile, getProfileMeta, listMyDocuments } from "@/lib/me-store";
import { getDocuments, getPurchase, listPurchases, loadDocuments, savePurchase } from "@/lib/purchase-store";
import { installFakeIndexedDB, type FakeIndexedDb } from "@/lib/testing/fake-indexeddb.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "..");

type Call = { url: string; method: string; body: unknown };

const purchase = (id: string, extra: Record<string, unknown> = {}): Purchase =>
  ({ id, subject: "Закупка", createdAt: "2026-09-20T10:00:00.000Z", files: [], unreadable: [], requirements: {}, ...extra }) as unknown as Purchase;

const DOC_AVAILABLE = {
  id: "p1:0",
  name: "ТЗ.pdf",
  scan: true,
  sizeBytes: 10,
  sha256: "a".repeat(64),
  ocr: false,
  readError: null,
  mimeType: "application/pdf",
  text: "Текст ТЗ",
  map: { spans: [{ from: 0, to: 3, page: 1 }] },
  textStatus: "available" as const,
};
const DOC_MISSING = { ...DOC_AVAILABLE, id: "p1:1", name: "Пропавший.pdf", text: null, textStatus: "missing" as const, readError: "объект не найден" };

const SAMPLE_NEW = { id: "s2", name: "Б.pdf", kinds: ["tp"], about: "", addedAt: "2026-09-02T00:00:00.000Z", scan: true, text: "б", map: null, textStatus: "available" as const };
const SAMPLE_OLD = { id: "s1", name: null, kinds: ["tp"], about: "", addedAt: "2026-09-01T00:00:00.000Z", scan: false, text: "а", map: null, textStatus: "available" as const };

const FACT: Fact = {
  id: "f1",
  kind: "license",
  title: "Лицензия",
  fields: {},
  measures: [],
  validity: {},
  source: { type: "manual" },
  origin: "human",
  confirmed: true,
  createdAt: "",
  updatedAt: "",
};

const PROFILE: Profile = { ...EMPTY_PROFILE, fullName: "ООО Ромашка", inn: "7700000000" };
const PROFILE_META = { version: 1, sources: { inn: "Анкета.pdf" }, suggestions: [{ key: "kpp", value: "1", source: "Анкета.pdf" }] };

let calls: Call[];
let state: { purchases: Purchase[] };
let previousFetch: typeof fetch | undefined;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ source: "postgres", data }), { status, headers: { "Content-Type": "application/json" } });

function installServer(handlers: (url: string, method: string, body: unknown) => Response | undefined): void {
  calls = [];
  previousFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { method?: string; body?: string }) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url: String(url), method, body });
    return handlers(String(url), method, body) ?? json(null, 404);
  }) as typeof fetch;
}

/** Обычный набор серверных ответов чтения (без записи). */
function readHandlers(url: string, method: string): Response | undefined {
  if (method !== "GET") return undefined;
  if (url === "/api/reads/purchases") return json(state.purchases);
  if (url.startsWith("/api/reads/purchases/")) {
    const id = decodeURIComponent(url.slice("/api/reads/purchases/".length));
    const found = state.purchases.find((p) => p.id === id);
    return found ? json(found) : json(null, 404);
  }
  if (url.startsWith("/api/reads/documents")) return json([DOC_AVAILABLE, DOC_MISSING]);
  if (url === "/api/reads/samples") return json([SAMPLE_NEW, SAMPLE_OLD]);
  if (url === "/api/reads/facts") return json([FACT]);
  if (url === "/api/reads/profile") return json({ profile: PROFILE, meta: PROFILE_META, userId: "u1" });
  return undefined;
}

/** IndexedDB выключен: любое обращение — ошибка, а не тихий фолбэк. */
function blockIndexedDb(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    get() {
      throw new Error("IndexedDB must not be used for production reads");
    },
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    else delete (globalThis as Record<string, unknown>).indexedDB;
  };
}

before(() => {
  process.env.NEXT_PUBLIC_SERVER_READS = "1";
});

beforeEach(() => {
  state = { purchases: [purchase("p1", { tpPrice: 100 })] };
});

after(() => {
  if (previousFetch) globalThis.fetch = previousFetch;
  delete process.env.NEXT_PUBLIC_SERVER_READS;
  delete process.env.NEXT_PUBLIC_SERVER_WRITES;
});

test("IndexedDB unavailable: все production-чтения идут с сервера", async () => {
  installServer(readHandlers);
  const restore = blockIndexedDb();
  try {
    const purchases = await listPurchases();
    assert.deepEqual(purchases.map((p) => p.id), ["p1"]);

    assert.equal((await getPurchase("p1"))?.tpPrice, 100);
    assert.equal(await getPurchase("missing"), undefined);

    const docs = await getDocuments("p1");
    assert.deepEqual(docs.map((d) => d.name), ["ТЗ.pdf"], "нечитаемый документ не превращается в пустой");
    assert.equal(docs[0].text, "Текст ТЗ");
    assert.deepEqual(docs[0].map, DOC_AVAILABLE.map);

    const loaded = await loadDocuments("p1");
    assert.deepEqual(loaded.documents.map((d) => d.name), ["ТЗ.pdf"]);
    assert.deepEqual(loaded.unreadable, [{ name: "Пропавший.pdf", reason: "объект не найден" }]);

    const samples = await listMyDocuments();
    assert.deepEqual(samples.map((s) => s.id), ["s2", "s1"], "порядок по addedAt убыванию");
    assert.equal(samples[1].name, "", "null-имя обработано явно");

    assert.equal((await getProfile()).fullName, "ООО Ромашка");
    const meta = await getProfileMeta();
    assert.equal(meta.sources.inn, "Анкета.pdf");
    assert.deepEqual(meta.suggestions, [{ key: "kpp", value: "1", source: "Анкета.pdf" }]);

    assert.deepEqual((await listFacts()).map((f) => f.id), ["f1"]);
    assert.ok(calls.length > 0 && calls.every((c) => c.url.startsWith("/api/reads/")), "только серверные чтения");
  } finally {
    restore();
  }
});

test("IndexedDB пуст: UI не пустой, данные приходят с сервера", async () => {
  const idb: FakeIndexedDb = installFakeIndexedDB();
  idb.reset();
  installServer(readHandlers);
  try {
    assert.deepEqual((await listPurchases()).map((p) => p.id), ["p1"], "пустой IndexedDB не делает список пустым");
    assert.equal((await listMyDocuments()).length, 2);
    assert.equal((await getProfile()).fullName, "ООО Ромашка");
    assert.equal((await listFacts()).length, 1);
  } finally {
    idb.uninstall();
  }
});

test("мутация → серверная запись → refetch серверного состояния", async () => {
  const idb: FakeIndexedDb = installFakeIndexedDB();
  idb.reset();
  process.env.NEXT_PUBLIC_SERVER_WRITES = "1";
  installServer((url, method, body) => {
    if (method === "PUT" && url.startsWith("/api/writes/purchases/")) {
      const { purchase: saved } = body as { purchase: Purchase };
      state.purchases = [...state.purchases.filter((p) => p.id !== saved.id), saved];
      return json({ ok: true });
    }
    return readHandlers(url, method);
  });

  let notified = 0;
  const off = onDataChanged(() => {
    notified += 1;
  });
  try {
    assert.equal((await listPurchases())[0].tpPrice, 100);
    await savePurchase(purchase("p1", { tpPrice: 200 }));
    assert.equal(notified, 1, "подписчик уведомлён после завершённой мутации");
    assert.equal((await listPurchases())[0].tpPrice, 200, "UI перечитывает серверное состояние");
  } finally {
    off();
    idb.uninstall();
  }
});

test("onDataChanged больше не связан с IndexedDB: import только из data-events", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;
      const code = readFileSync(full, "utf8");
      if (/onDataChanged[^\n]*from\s+["']@\/lib\/db["']/.test(code) || /from\s+["']@\/lib\/db["'][^\n]*onDataChanged/.test(code)) {
        offenders.push(path.relative(SRC, full));
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], "production-код не импортирует onDataChanged из lib/db");
});
