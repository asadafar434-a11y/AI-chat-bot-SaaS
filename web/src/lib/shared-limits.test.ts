// Общий счёт лимитов и бюджета ИИ для нескольких серверов — npm test. Базы тут нет: «общее хранилище» — в памяти, поломки — подставные.
import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryHitStore, sharedBudget, sharedLimiter, sharedLimitsOn, type HitStore, type SpendStore } from "./shared-limits.ts";

const MINUTE = 60_000;
const WINDOWS = [{ max: 3, ms: MINUTE }];
const silent = { log: () => {} };

test("общий счёт включается только настройкой SHARED_LIMITS=db", () => {
  assert.equal(sharedLimitsOn({ SHARED_LIMITS: "db" }), true);
  for (const value of [undefined, "", "memory", "DB", "1", "true"]) assert.equal(sharedLimitsOn({ SHARED_LIMITS: value }), false, String(value));
});

test("без хранилища лимитер считает в памяти сервера — как раньше: три можно, четвёртый ждёт", async () => {
  let t = 1_000_000;
  const take = sharedLimiter("test", WINDOWS, async () => null, { now: () => t, ...silent });
  assert.deepEqual([await take("ip"), await take("ip"), await take("ip")], [0, 0, 0]);
  assert.equal(await take("ip"), 60, "через минуту освободится место");
  assert.equal(await take("other"), 0, "у другого адреса счёт свой");
  t += MINUTE + 1;
  assert.equal(await take("ip"), 0);
});

test("два сервера с общим хранилищем считают вместе: лимит три на обоих, а не по три на каждого", async () => {
  const shared = memoryHitStore();
  const t = 5_000_000;
  const a = sharedLimiter("ai", WINDOWS, async () => shared, { now: () => t, ...silent });
  const b = sharedLimiter("ai", WINDOWS, async () => shared, { now: () => t, ...silent });
  assert.deepEqual([await a("ip"), await b("ip"), await a("ip")], [0, 0, 0]);
  assert.ok((await b("ip")) > 0, "четвёртый запрос на любом из серверов ждёт");
  assert.ok((await a("ip")) > 0);
  // Корзины разные — счёт тоже: вход не съедает лимит ИИ.
  const login = sharedLimiter("login", WINDOWS, async () => shared, { now: () => t, ...silent });
  assert.equal(await login("ip"), 0);
  // Без общего хранилища каждый сервер разрешил бы по три — это и было пунктом 18.
  const lone = sharedLimiter("ai", WINDOWS, async () => null, { now: () => t, ...silent });
  assert.deepEqual([await lone("x"), await lone("x"), await lone("x")], [0, 0, 0]);
});

test("запрос берёт cost единиц: файл из 20 страниц не пролезает в остаток", async () => {
  const shared = memoryHitStore();
  const take = sharedLimiter("ocr", [{ max: 25, ms: MINUTE }], async () => shared, { now: () => 1, ...silent });
  assert.equal(await take("all", 20), 0);
  assert.ok((await take("all", 20)) > 0);
  assert.equal(await take("all", 5), 0);
});

test("база не ответила — запрос не блокируется: счёт в памяти этого сервера, в журнал — одна строка", async () => {
  const broken: HitStore = {
    async take() {
      throw new Error("connection refused");
    },
  };
  const lines: string[] = [];
  const take = sharedLimiter("login", WINDOWS, async () => broken, { now: () => 1, log: (m) => lines.push(m) });
  assert.deepEqual([await take("ip"), await take("ip"), await take("ip")], [0, 0, 0]);
  assert.ok((await take("ip")) > 0, "лимит работает и без базы");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[лимиты\] login: база не ответила, считаем в памяти этого сервера \(connection refused\)/);
});

test("не вышло получить хранилище (нет настроек базы) — то же: счёт в памяти", async () => {
  const lines: string[] = [];
  const take = sharedLimiter("files", WINDOWS, async () => { throw new Error("DATABASE_URL не задан"); }, { now: () => 1, log: (m) => lines.push(m) });
  assert.equal(await take("ip"), 0);
  assert.equal(lines.length, 1);
});

// Общая таблица расходов в памяти — как AiSpend в базе.
function memorySpend(): SpendStore & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  return {
    rows,
    async spent(id) {
      return rows.get(id) ?? 0;
    },
    async charge(id, usd) {
      rows.set(id, (rows.get(id) ?? 0) + usd);
    },
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("бюджет заявки общий: что потратил один сервер, второй видит и останавливается", async () => {
  const table = memorySpend();
  const a = sharedBudget(1, async () => table, silent);
  const b = sharedBudget(1, async () => table, silent);
  a.charge("app-1", 0.7);
  await flush();
  assert.equal(await b.spent("app-1"), 0.7);
  assert.ok(Math.abs((await b.left("app-1")) - 0.3) < 1e-9);
  b.charge("app-1", 0.4);
  await flush();
  assert.equal(await a.left("app-1"), 0, "бюджет в 1 ₽ исчерпан двумя серверами вместе");
  assert.equal(await a.left("app-2"), 1, "другая заявка не затронута");
  assert.equal(a.spentHere("app-1"), 0.7, "для строки журнала — счёт этого сервера");
});

test("без хранилища бюджет считается в памяти; при ошибке базы — тоже, и ответ участнику не ждёт запись", async () => {
  const lone = sharedBudget(1, async () => null, silent);
  lone.charge("a", 0.25);
  assert.equal(await lone.left("a"), 0.75);
  const lines: string[] = [];
  const broken: SpendStore = {
    async spent() { throw new Error("база недоступна"); },
    async charge() { throw new Error("база недоступна"); },
  };
  const budget = sharedBudget(1, async () => broken, { log: (m) => lines.push(m) });
  budget.charge("a", 0.4);
  await flush();
  assert.equal(await budget.left("a"), 0.6, "свой счёт на месте");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[лимиты\] бюджет ИИ: база не ответила/);
});
