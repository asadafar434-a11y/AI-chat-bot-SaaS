// Хранилище лимитов и бюджета в PostgreSQL — npm test. Живой базы здесь нет: клиент подставной, он разбирает запросы и ведёт «таблицы» в памяти.
// Проверяется порядок запросов, блокировка ключа и то, что запись делается только когда место есть. Живую базу проверяют при выкладке с несколькими серверами.
import assert from "node:assert/strict";
import { test } from "node:test";
import { prismaHitStore, prismaSpendStore, type RawClient, type RawTx } from "./shared-limits-store.ts";

const sql = (strings: TemplateStringsArray) => strings.join("?").replace(/\s+/g, " ").trim();

function fakeClient() {
  const calls: string[] = [];
  const hits: { bucket: string; key: string; at: number }[] = [];
  const spend = new Map<string, number>();
  let transactions = 0;
  const tx: RawTx = {
    async $queryRaw(strings, ...values) {
      const q = sql(strings);
      calls.push(q);
      if (q.startsWith("SELECT pg_advisory_xact_lock")) return [{ pg_advisory_xact_lock: "" }] as never;
      if (q.startsWith('SELECT "at" FROM "RateHit"')) {
        const [bucket, key] = values as [string, string];
        return hits.filter((h) => h.bucket === bucket && h.key === key).sort((x, y) => x.at - y.at).map((h) => ({ at: new Date(h.at) })) as never;
      }
      if (q.startsWith('SELECT "usd" FROM "AiSpend"')) return (spend.has(values[0] as string) ? [{ usd: spend.get(values[0] as string) }] : []) as never;
      throw new Error(`неожиданный запрос: ${q}`);
    },
    async $executeRaw(strings, ...values) {
      const q = sql(strings);
      calls.push(q);
      if (q.startsWith('DELETE FROM "RateHit" WHERE "bucket"')) {
        const [bucket, key, before] = values as [string, string, Date];
        for (let i = hits.length - 1; i >= 0; i--) if (hits[i].bucket === bucket && hits[i].key === key && hits[i].at <= before.getTime()) hits.splice(i, 1);
        return 0;
      }
      if (q.startsWith('DELETE FROM "RateHit" WHERE "at" <')) return 0;
      if (q.startsWith('INSERT INTO "RateHit"')) {
        const [bucket, key, at, cost] = values as [string, string, Date, number];
        for (let i = 0; i < cost; i++) hits.push({ bucket, key, at: at.getTime() });
        return cost;
      }
      if (q.startsWith('INSERT INTO "AiSpend"')) {
        const [appId, usd] = values as [string, number];
        spend.set(appId, (spend.get(appId) ?? 0) + usd);
        return 1;
      }
      if (q.startsWith('DELETE FROM "AiSpend"')) return 0;
      throw new Error(`неожиданный запрос: ${q}`);
    },
  };
  const client: RawClient = {
    ...tx,
    async $transaction(fn) {
      transactions++;
      return fn(tx);
    },
  };
  return { client, calls, hits, spend, transactions: () => transactions };
}

const WINDOWS = [{ max: 2, ms: 60_000 }];

test("лимиты: два запроса в окне можно, третий ждёт; всё — в одной транзакции, ключ блокируется первым запросом", async () => {
  const db = fakeClient();
  const store = prismaHitStore(db.client);
  assert.equal(await store.take("login-ip", "1.2.3.4", WINDOWS, 1, 1_000_000), 0);
  assert.equal(await store.take("login-ip", "1.2.3.4", WINDOWS, 1, 1_010_000), 0);
  assert.equal(await store.take("login-ip", "1.2.3.4", WINDOWS, 1, 1_020_000), 40, "первый запрос выйдет из окна через 40 с");
  assert.equal(db.hits.length, 2, "отказанный запрос в таблицу не пишется");
  assert.equal(db.transactions(), 3);
  assert.match(db.calls[0], /^SELECT pg_advisory_xact_lock\(hashtextextended\(\?, 0\)\)$/);
  assert.deepEqual(db.calls.slice(0, 4).map((c) => c.split(" ").slice(0, 2).join(" ")), ["SELECT pg_advisory_xact_lock(hashtextextended(?,", "DELETE FROM", 'SELECT "at"', "INSERT INTO"]);
});

test("лимиты: окно проходит — место освобождается; у другого ключа и другой корзины счёт свой; запрос на cost единиц пишет cost строк", async () => {
  const db = fakeClient();
  const store = prismaHitStore(db.client);
  assert.equal(await store.take("ai-ip", "a", WINDOWS, 2, 5_000_000), 0);
  assert.ok((await store.take("ai-ip", "a", WINDOWS, 1, 5_001_000)) > 0);
  assert.equal(await store.take("ai-ip", "b", WINDOWS, 1, 5_001_000), 0);
  assert.equal(await store.take("login-ip", "a", WINDOWS, 1, 5_001_000), 0);
  assert.equal(await store.take("ai-ip", "a", WINDOWS, 1, 5_061_000), 0, "через минуту старые запросы вышли из окна");
  assert.equal(db.hits.filter((h) => h.bucket === "ai-ip" && h.key === "a").length, 1, "старые строки убраны при следующем запросе");
});

test("лимиты: ошибка базы поднимается наверх (там её ловит лимитер и считает в памяти)", async () => {
  const db = fakeClient();
  const broken: RawClient = { ...db.client, async $transaction() { throw new Error("connection refused"); } };
  await assert.rejects(prismaHitStore(broken).take("ai", "k", WINDOWS, 1, 1), /connection refused/);
});

test("бюджет: расход прибавляется в самой базе, читается по номеру заявки; нет строки — ноль", async () => {
  const db = fakeClient();
  const store = prismaSpendStore(db.client);
  assert.equal(await store.spent("app-1"), 0);
  await store.charge("app-1", 0.25);
  await store.charge("app-1", 0.5);
  assert.equal(await store.spent("app-1"), 0.75);
  assert.equal(await store.spent("app-2"), 0);
  const insert = db.calls.find((c) => c.startsWith('INSERT INTO "AiSpend"'))!;
  assert.match(insert, /ON CONFLICT \("appId"\) DO UPDATE SET "usd" = \(CASE WHEN "AiSpend"\."updatedAt" > now\(\) - interval '30 days' THEN "AiSpend"\."usd" ELSE 0 END\) \+ EXCLUDED\."usd"/);
});
