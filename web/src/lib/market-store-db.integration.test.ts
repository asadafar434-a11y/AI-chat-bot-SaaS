/**
 * Рыночные ценовые наблюдения в настоящей PostgreSQL: добавление, отсечение повторов, отбор кандидатов по словам названия, единице и датам.
 *
 * Пропускается без `TEST_DATABASE_URL` (как остальные интеграционные проверки): отсутствие базы не должно выглядеть как «проверено».
 * Схема должна быть развёрнута заранее (npx prisma migrate deploy на тестовой базе). Тест подчищает только свои строки (источник «itest-…»).
 *
 *   $env:DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/tender_lawyer_test?schema=public"; npx prisma migrate deploy
 *   $env:TEST_DATABASE_URL=$env:DATABASE_URL; npm test
 */
import assert from "node:assert/strict";
import test from "node:test";

const URL = process.env.TEST_DATABASE_URL;
const skip = URL ? false : "TEST_DATABASE_URL не задан: проверка настоящей базы пропущена";

test("наблюдения в PostgreSQL: добавление, повтор, отбор кандидатов и расчёт ориентира", { skip }, async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = URL;
  const { createPrismaClient } = await import("../server/db/client.ts");
  const { createDbMarketStore } = await import("./market-store-db.ts");
  const { makeObservation, marketStats, tokensOf } = await import("./market-observations.ts");

  const db = createPrismaClient();
  const store = createDbMarketStore(db as never);
  const stamp = `itest-${Date.now()}`;
  const mk = (name: string, unit: string, price: number, date: string, region: string | null = null) => {
    const built = makeObservation({ name, unit, price, vat: "without", vatRate: 22, date, region, source: `${stamp}: прайс ${price}-${date}`, sourceKind: "price_list" });
    assert.ok(built.ok);
    return built.value;
  };

  try {
    const coal = [5000, 5100, 5200, 4900, 5050].map((p, i) => mk("Уголь каменный ДПК", "т", p, `2026-0${i + 4}-15`, i < 3 ? "Севастополь" : null));
    const other = [mk("Сахар песок", "т", 60000, "2026-09-01"), mk("Уголь каменный ДПК", "кг", 5, "2026-09-01")];
    const first = await store.ingest([...coal, ...other], "itest");
    assert.equal(first.added, 7);
    // Повторная загрузка того же файла ничего не добавляет.
    const again = await store.ingest(coal, "itest");
    assert.deepEqual(again, { added: 0, skipped: 5 });

    const found = await store.candidates({ unit: "т", tokens: tokensOf("Уголь ДПК"), since: "2025-01-01", until: "2026-10-22", limit: 100 });
    const mine = found.filter((o) => o.source.startsWith(stamp));
    assert.equal(mine.length, 5, "единица «т» и слова угля; сахар и уголь в килограммах не пришли");
    assert.ok(mine.every((o) => o.unit === "т"));
    assert.equal(mine[0].observedAt, "2026-08-15", "новые первыми, дата вернулась как день без времени");
    assert.deepEqual(mine[0].tokens, tokensOf("Уголь каменный ДПК"));
    assert.equal(mine[0].priceNoVat, 5050, "цена вернулась числом");

    const limited = await store.candidates({ unit: "т", tokens: tokensOf("Уголь ДПК"), since: "2026-05-01", until: "2026-07-01", limit: 100 });
    assert.deepEqual(limited.filter((o) => o.source.startsWith(stamp)).map((o) => o.observedAt).sort(), ["2026-05-15", "2026-06-15"], "даты — включительно, остальное отсечено");

    const stats = marketStats({ name: "Уголь каменный ДПК", unit: "т", region: "Севастополь" }, mine, "2026-10-22");
    assert.equal(stats.status, "ok");
    assert.equal(stats.n, 5);
    assert.equal(stats.median, 5050);
    assert.ok((await store.count()) >= 7);
  } finally {
    await db.priceObservation.deleteMany({ where: { source: { startsWith: stamp } } });
    await db.$disconnect();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
