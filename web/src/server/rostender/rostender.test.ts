import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeListing } from "../../lib/tender-normalize.ts";
import type { TenderListing } from "../../lib/tender-search.ts";
import { createRostenderClient, RostenderError } from "./client.ts";
import { handleRostender } from "./handler.ts";
import { moscowToday, resetTenderSyncState, SYNC_STALE_MS, tickTenderSync } from "./schedule.ts";
import type { TenderList, TenderStore } from "./store.ts";
import { syncTenders } from "./sync.ts";

// Ростендер без сети: подставной fetch отвечает так, как описано в rostender.info/docs/api — npm test.
const KEY = "СЕКРЕТНЫЙ-КЛЮЧ";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const short = (id: number, region: string, price: number) => ({ id, url: `https://rostender.info/${id}`, dts: 1793178000, dte: 1793869200 + id * 3600, price: { value: price, currency: "RUB" }, place: "ЕИС", regions: [region], stage: "Подача" });
const card = (id: number) => ({ success: true, data: { id, url: `https://rostender.info/${id}`, dts: 1793178000, dte: 1793869200, price: { value: 1000 * id, currency: "RUB" }, descr: `Закупка ${id}`, regions: ["Москва"], placement: { title: "Аукцион" }, customer: { name: "Заказчик", inn: "7751322445" }, eis: { number: String(id).padStart(19, "0") }, files: { archive: `https://rostender.info/f/${id}.zip`, items: [{ title: "Извещение.pdf", link: `https://rostender.info/f/${id}/1`, extension: "pdf", size: 10 }] } } });

type Setup = { remaining?: number; items?: ReturnType<typeof short>[]; pages?: number; failCard?: (id: number) => Response | null; infoStatus?: number };
function fake(setup: Setup = {}) {
  const calls: { path: string; key: string | null }[] = [];
  let remaining = setup.remaining ?? 100;
  const items = setup.items ?? Array.from({ length: 60 }, (_, i) => short(i + 1, ["Москва", "Тверская область", "Краснодарский край"][i % 3], [50_000, 500_000, 5_000_000, 50_000_000][i % 4]));
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace("/api/tenders/get/", "");
    calls.push({ path: path + (u.search || ""), key: (init.headers as Record<string, string>)["X-API-KEY"] ?? null });
    if (path === "info") return setup.infoStatus ? json({ success: false, message: "нет" }, setup.infoStatus) : json({ success: true, data: { daily_limit: 100, used_today: 100 - remaining, remaining, resets_at: "2026-11-06 00:00:00", current_api_key: KEY } });
    if (path === "templates") return json({ success: true, data: [{ id: 7, title: "Мероприятия" }] });
    if (path.startsWith("template/")) {
      const page = Number(u.searchParams.get("page") ?? 1);
      if (remaining <= 0) return json({ success: false, message: "лимит" }, 403);
      remaining--;
      const per = 40;
      return json({ success: true, data: items.slice((page - 1) * per, page * per), _meta: { totalCount: items.length, pageCount: Math.ceil(items.length / per), currentPage: page, perPage: per } }, 200, { "X-RateLimit-Remaining": String(remaining) });
    }
    const id = Number(path);
    const custom = setup.failCard?.(id);
    if (custom) return custom;
    if (remaining <= 0) return json({ success: false, message: "лимит" }, 403);
    remaining--;
    return json(card(id), 200, { "X-RateLimit-Remaining": String(remaining) });
  }) as typeof fetch;
  return { fetcher, calls, left: () => remaining };
}

test("запрос: ключ уходит в заголовке X-API-KEY, а не в адресе; info — состояние без самого ключа", async () => {
  const { fetcher, calls } = fake();
  const client = createRostenderClient({ apiKey: ` ${KEY} `, fetcher });
  const info = await client.info();
  assert.deepEqual(info, { limit: 100, used: 0, remaining: 100, resetsAt: "2026-11-06 00:00:00" });
  assert.equal(calls[0].key, KEY);
  assert.equal(calls[0].path.includes(KEY), false, "в адресе ключа нет");
  assert.equal(JSON.stringify(info).includes(KEY), false);
  assert.deepEqual(await client.templates(), [{ id: "7", title: "Мероприятия" }]);
});

test("ошибки: 401 — ключ не принят, 403 — лимит или тариф, ключ в тексте не появляется", async () => {
  const bad = (status: number, message = `ключ ${KEY} плохой`) => createRostenderClient({ apiKey: KEY, fetcher: (async () => json({ success: false, message }, status)) as typeof fetch });
  await assert.rejects(bad(401).info(), (e: unknown) => e instanceof RostenderError && /не принял ключ/.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(bad(403).card("1"), (e: unknown) => e instanceof RostenderError && e.status === 429 && /лимит/.test(e.message));
  const soft = createRostenderClient({ apiKey: KEY, fetcher: (async () => json({ success: false, message: `ошибка ${KEY}` })) as typeof fetch });
  await assert.rejects(soft.info(), (e: unknown) => e instanceof RostenderError && !e.message.includes(KEY) && e.message.includes("***"));
  const notFound = createRostenderClient({ apiKey: KEY, fetcher: (async () => new Response("", { status: 404 })) as typeof fetch });
  assert.deepEqual(await notFound.card("1"), { listing: null, remaining: null });
  const down = createRostenderClient({ apiKey: KEY, fetcher: (async () => { throw new Error("сеть"); }) as typeof fetch });
  await assert.rejects(down.info(), (e: unknown) => e instanceof RostenderError && e.status === 504);
});

/** Хранилище в памяти: те же правила, что у настоящего (повторная запись той же закупки обновляет карточку). */
function memoryStore(initial: TenderListing[] = []) {
  const rows = new Map<string, { listing: TenderListing; seen: number }>(initial.map((l) => [l.id, { listing: l, seen: 1 }]));
  const store: TenderStore & { rows: typeof rows } = {
    rows,
    async known() {
      const fresh = new Set<string>();
      const stale = new Set<string>();
      for (const r of rows.values()) if (r.listing.rostenderId) ((r.listing.rev ?? 1) >= 2 ? fresh : stale).add(r.listing.rostenderId);
      return { fresh, stale };
    },
    async save(listings) {
      let n = 0;
      for (const raw of listings) {
        const l = normalizeListing(raw);
        if (!l) continue;
        rows.set(l.id, { listing: l, seen: Date.now() });
        n++;
      }
      return n;
    },
    async touch(ids) {
      for (const r of rows.values()) if (r.listing.rostenderId && ids.includes(r.listing.rostenderId)) r.seen = Date.now();
    },
    async expire(today) {
      let n = 0;
      for (const [id, r] of rows) {
        if (r.listing.deadline && r.listing.deadline < today) {
          rows.delete(id);
          n++;
        }
      }
      return n;
    },
    async list(today, limit): Promise<TenderList> {
      const listings = [...rows.values()].map((r) => r.listing).filter((l) => !l.deadline || l.deadline >= today).slice(0, limit);
      return { listings, total: listings.length, updatedAt: rows.size ? new Date().toISOString() : null };
    },
    async lastSyncAt() {
      const seen = [...rows.values()].map((r) => r.seen);
      return seen.length ? new Date(Math.max(...seen)) : null;
    },
  };
  return store;
}

const TODAY = "2026-11-05";

test("загрузка: читает списки, берёт карточки только новых закупок, считает списанные запросы; в базе документы и архив", async () => {
  const { fetcher, calls, left } = fake({ remaining: 100, items: Array.from({ length: 30 }, (_, i) => short(i + 1, "Москва", 50_000)) });
  const store = memoryStore();
  const r = await syncTenders({ client: createRostenderClient({ apiKey: KEY, fetcher }), store, today: TODAY });
  assert.equal(r.ok, true);
  assert.equal(r.listed, 30);
  assert.equal(r.added, 30);
  assert.equal(r.spent, 1 + 30, "одна страница списка и тридцать карточек");
  assert.equal(left(), 69);
  assert.ok([...store.rows.values()].every((x) => x.listing.docs?.length === 1 && x.listing.archive?.endsWith(".zip") && x.listing.source === "rostender"));
  assert.equal(JSON.stringify([...store.rows.values()]).includes(KEY), false);
  assert.ok(calls.every((c) => c.key === KEY));

  // На другой день: те же закупки уже есть — карточки не берутся, списывается только страница списка.
  const again = await syncTenders({ client: createRostenderClient({ apiKey: KEY, fetcher }), store, today: TODAY });
  assert.equal(again.added, 0);
  assert.equal(again.spent, 1);
});

test("загрузка: не тратит запас лимита, говорит, что остальное в следующие дни; при почти нулевом лимите откладывает", async () => {
  const items = Array.from({ length: 40 }, (_, i) => short(i + 1, "Москва", 50_000));
  const { fetcher } = fake({ remaining: 25, items });
  const store = memoryStore();
  const r = await syncTenders({ client: createRostenderClient({ apiKey: KEY, fetcher }), store, today: TODAY, reserve: 10 });
  assert.equal(r.ok, true);
  assert.ok(r.spent <= 15, `списано ${r.spent}`);
  assert.ok(r.added >= 10 && r.added < 40);
  assert.match(r.note ?? "", /следующие дни/);
  const low = await syncTenders({ client: createRostenderClient({ apiKey: KEY, fetcher: fake({ remaining: 8 }).fetcher }), store: memoryStore(), today: TODAY });
  assert.equal(low.ok, false);
  assert.match(low.note ?? "", /отложена/);
});

test("загрузка: закупки с вышедшим сроком не берутся, а ранее сохранённые с вышедшим сроком убираются", async () => {
  const items = [short(1, "Москва", 1000), { ...short(2, "Москва", 1000), dte: 1793000000 }]; // 2026-10-26 — уже закончилась
  const { fetcher } = fake({ items });
  const old = normalizeListing({ id: "old", title: "Старая", deadline: "2026-10-01", source: "rostender", rostenderId: "999" })!;
  const store = memoryStore([old]);
  const r = await syncTenders({ client: createRostenderClient({ apiKey: KEY, fetcher }), store, today: TODAY });
  assert.equal(r.added, 1);
  assert.equal(r.removed, 1);
  assert.equal(store.rows.has("old"), false);
});

test("загрузка: одна карточка не получилась — остальные берутся; ключ не принят — остановка", async () => {
  const items = Array.from({ length: 10 }, (_, i) => short(i + 1, "Москва", 1000));
  const { fetcher } = fake({ items, failCard: (id) => (id === 4 ? new Response("", { status: 500 }) : null) });
  const r = await syncTenders({ client: createRostenderClient({ apiKey: KEY, fetcher }), store: memoryStore(), today: TODAY });
  assert.equal(r.added, 9);
  assert.equal(r.failed, 1);
  const bad = fake({ items, failCard: () => json({ success: false, message: "нет" }, 401) });
  const stopped = await syncTenders({ client: createRostenderClient({ apiKey: KEY, fetcher: bad.fetcher }), store: memoryStore(), today: TODAY });
  assert.match(stopped.note ?? "", /не принял ключ/);
  assert.equal(stopped.added, 0);
});

test("расписание: свежая отметка в базе не даёт запуститься, старая (больше 20 часов) запускает один раз", async () => {
  resetTenderSyncState();
  const store = memoryStore();
  let runs = 0;
  const run = async () => {
    runs++;
    return { ok: true, note: null, templates: 1, listed: 0, added: 0, failed: 0, removed: 0, spent: 0, remaining: 100 };
  };
  assert.ok(await tickTenderSync({ run, store, now: () => 1_000_000 }), "база пуста — запуск");
  assert.equal(runs, 1);
  assert.equal(await tickTenderSync({ run, store, now: () => 1_000_000 + 60 * 60 * 1000 }), null, "через час — рано");
  assert.ok(await tickTenderSync({ run, store, now: () => 1_000_000 + SYNC_STALE_MS + 1 }), "через 20 часов — пора");
  assert.equal(runs, 2);
  resetTenderSyncState();
  const fresh = memoryStore([normalizeListing({ id: "x", title: "x", source: "rostender", rostenderId: "1" })!]);
  await fresh.save([normalizeListing({ id: "y", title: "y", source: "rostender", rostenderId: "2" })!]);
  assert.equal(await tickTenderSync({ run, store: fresh, now: () => Date.now() + 1000 }), null, "в базе свежая отметка — не запускаем");
  assert.equal(moscowToday(new Date("2026-11-05T22:30:00Z")), "2026-11-06", "после 21:00 UTC в Москве уже следующий день");
});

const post = (body: unknown) => new Request("http://localhost/api/rostender", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const allow = async () => null;

test("маршрут: без входа — отказ, кривой ввод — 400, без базы — пустой список; список — из базы", async () => {
  const store = memoryStore([normalizeListing({ id: "a", title: "Закупка", deadline: "2026-12-01", source: "rostender", rostenderId: "1" })!, normalizeListing({ id: "b", title: "Старая", deadline: "2026-10-01" })!]);
  const base = { authorize: allow, store, configured: true, today: () => TODAY };
  assert.equal((await handleRostender(post({ action: "list" }), { ...base, authorize: async () => new Response("Требуется вход", { status: 401 }) })).status, 401);
  assert.equal((await handleRostender(post("не json"), base)).status, 400);
  assert.equal((await handleRostender(post({ action: "sample" }), base)).status, 400);
  const none = await handleRostender(post({ action: "list" }), { ...base, store: null, configured: false });
  assert.deepEqual(await none.json(), { configured: false, listings: [], total: 0, updatedAt: null });
  const ok = (await (await handleRostender(post({ action: "list" }), base)).json()) as { configured: boolean; listings: TenderListing[]; total: number };
  assert.equal(ok.configured, true);
  assert.deepEqual(ok.listings.map((l) => l.id), ["a"], "закончившаяся не показывается");
  const broken: TenderStore = { ...store, list: async () => { throw new Error("база упала"); } };
  const logged = console.error;
  console.error = () => {};
  try {
    const failed = await handleRostender(post({ action: "list" }), { ...base, store: broken });
    assert.equal(failed.status, 502);
    assert.equal((await failed.text()).includes("база упала"), false);
  } finally {
    console.error = logged;
  }
});

test("загрузка: карточки со старым набором полей обновляются в последнюю очередь — после новых закупок и только если хватает лимита", async () => {
  const items = Array.from({ length: 6 }, (_, i) => short(i + 1, "Москва", 1000));
  const oldOnes = [1, 2, 3].map((id) => normalizeListing({ id: String(id).padStart(19, "0"), title: "Старая карточка", deadline: "2026-12-01", source: "rostender", rostenderId: String(id) })!);
  const { fetcher, calls } = fake({ items });
  const store = memoryStore(oldOnes);
  const r = await syncTenders({ client: createRostenderClient({ apiKey: KEY, fetcher }), store, today: TODAY, maxCards: 3 });
  assert.equal(r.added, 3);
  const fetched = calls.filter((c) => /^\d+$/.test(c.path)).map((c) => Number(c.path));
  assert.deepEqual(fetched.sort(), [4, 5, 6], "сначала новые, старые подождут");
  const later = await syncTenders({ client: createRostenderClient({ apiKey: KEY, fetcher }), store, today: TODAY });
  assert.equal(later.added, 3, "в следующий раз обновились и старые");
  assert.ok([...store.rows.values()].every((x) => x.listing.rev === 2));
});
