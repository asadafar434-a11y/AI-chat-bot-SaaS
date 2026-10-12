/**
 * Реестр в настоящей PostgreSQL: импорт, повторы, изменения, поиск (русский полнотекст, ИНН, ОКПД2, модель, ТУ, защита от SQL).
 *
 * Пропускается без `TEST_DATABASE_URL` (как остальные интеграционные проверки): отсутствие базы не должно выглядеть как «проверено».
 * Схема должна быть развёрнута заранее (npx prisma migrate deploy на тестовой базе). Тест подчищает только свои строки:
 * выгрузки с отпечатком «itest-…» и записи, созданные ими.
 *
 *   $env:DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/tender_lawyer_test?schema=public"; npx prisma migrate deploy
 *   $env:TEST_DATABASE_URL=$env:DATABASE_URL; npm test
 */
import assert from "node:assert/strict";
import test from "node:test";

const URL = process.env.TEST_DATABASE_URL;
const skip = URL ? false : "TEST_DATABASE_URL не задан: проверка настоящей базы пропущена";

test("реестр в PostgreSQL: импорт, повтор, изменения, поиск", { skip }, async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = URL;
  const { createPrismaClient } = await import("../server/db/client.ts");
  const { createDbRegistryStore } = await import("./registry-store-db.ts");
  const { createMemoryRegistryStore } = await import("./registry-store.ts");
  const { importRegistry } = await import("./registry-import.ts");
  const { FIXTURE_HEADER, PREFACE, asRows, fixtureRow } = await import("./registry-fixtures.ts");
  const { resolveCard } = await import("./registry-service.ts");
  const { applyEdits } = await import("./product-card.ts");
  const { compact } = await import("./registry-text.ts");

  const db = createPrismaClient();
  const store = createDbRegistryStore(db as never);
  const datasetIds: string[] = [];
  const stamp = `itest-${Date.now()}`;
  const imp = async (sha: string, rows: ReturnType<typeof fixtureRow>[], allowShrink = false) => {
    const result = await importRegistry(store, { registryKind: "gisp_rpp_719", fileName: "itest.xlsx", fileSha256: `${stamp}-${sha}`, rows: asRows(PREFACE, rows), allowShrink, now: new Date("2026-10-12T00:00:00Z") });
    datasetIds.push(result.dataset.id);
    return result;
  };
  // Номера вида «0000…» не бывают настоящими; предприятия названы «ТЕСТОВОЕ».
  const A = { enterprise: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "АЛЬФА"', inn: "9900000011" };
  const B = { enterprise: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "БЕТА"', inn: "9900000012" };
  const base = [
    fixtureRow({ number: "00004001", ...A, name: "Кресло офисное тестовое КО-1" }),
    fixtureRow({ number: "00004002", ...A, name: "Кресло офисное тестовое КО-1М" }),
    fixtureRow({ number: "00004003", ...B, name: "Кресла для зала тестовые DS-2CD2043", okpd2: "31.01.11.150", madeBy: "801.222.000.000 ТУ" }),
    fixtureRow({ number: "00004004", ...B, name: "Стол письменный тестовый", okpd2: "31.09.11.120" }),
    fixtureRow({ number: "00004005", ...B, name: "Ресивер тестовый объемом 80 л", okpd2: "25.29.12" }),
  ];
  const mem = createMemoryRegistryStore();

  try {
    // 1. Первый импорт.
    const first = await imp("a", [...base, fixtureRow({ number: "00004001", ...A, name: "Кресло офисное тестовое КО-1", added: "2023-01-01", until: "2027-01-01", basisNumber: "ТЕСТ-ВТОРОЕ" })]);
    assert.equal(first.report.recordsAdded, 5);
    assert.equal(first.report.multiRowRecords, 1);
    const one = await store.getByNumber("gisp_rpp_719", "00004001");
    assert.ok(one);
    assert.equal(one.registryNumber, "00004001", "ведущие нули сохранены");
    assert.equal(one.bases.length, 2);
    assert.equal(one.validUntilMin, "2027-01-01");
    assert.equal(one.validUntil, "2029-09-01");
    assert.equal(typeof one.addedAt, "string");

    // 2. Повтор того же файла.
    const again = await imp("a", base);
    assert.equal(again.report.alreadyImported, true);

    // 3. Параллельно заполняем память теми же записями — для сравнения поиска.
    await importRegistry(mem, { registryKind: "gisp_rpp_719", fileName: "m.xlsx", fileSha256: `${stamp}-mem`, rows: asRows(PREFACE, [...base, fixtureRow({ number: "00004001", ...A, name: "Кресло офисное тестовое КО-1", added: "2023-01-01", until: "2027-01-01", basisNumber: "ТЕСТ-ВТОРОЕ" })]) });

    // 4. Поиск: настоящий SQL против памяти — одни и те же ответы.
    const queries: Parameters<typeof store.search>[0][] = [
      { registryKind: "gisp_rpp_719", inn: A.inn, limit: 50 },
      { registryKind: "gisp_rpp_719", okpd2Prefix: "31.01", limit: 50 },
      { registryKind: "gisp_rpp_719", okpd2Prefix: "3101", nameWords: ["кресло"], limit: 50 },
      { registryKind: "gisp_rpp_719", nameWords: ["кресла"], limit: 50 },
      { registryKind: "gisp_rpp_719", enterpriseWords: ["бета"], limit: 50 },
      { registryKind: "gisp_rpp_719", inn: A.inn, modelRef: compact("КО-1"), limit: 50 },
      { registryKind: "gisp_rpp_719", modelRef: compact("DS-2CD2043"), limit: 50 },
      { registryKind: "gisp_rpp_719", modelRef: compact("DS-2CD2043".replace("D", "Д")), limit: 50 },
      { registryKind: "gisp_rpp_719", standardRef: compact("ТУ801.222.000.000"), limit: 50 },
    ];
    const only = (numbers: string[]) => numbers.filter((n) => n.startsWith("00004")).sort();
    for (const q of queries) {
      const real = await store.search(q);
      const fake = await mem.search(q);
      const label = JSON.stringify({ ...q, registryKind: undefined });
      assert.deepEqual(only(real.records.map((r) => r.registryNumber)), only(fake.records.map((r) => r.registryNumber)), `память и PostgreSQL расходятся: ${label}`);
    }
    const byCase = await store.search({ registryKind: "gisp_rpp_719", nameWords: ["кресла"], inn: A.inn, limit: 10 });
    assert.deepEqual(only(byCase.records.map((r) => r.registryNumber)), ["00004001", "00004002"], "«кресла» находит «кресло» (русские падежи)");
    const latinCyr = await store.search({ registryKind: "gisp_rpp_719", modelRef: compact("DS-2CD2043"), limit: 10 });
    assert.ok(latinCyr.records.some((r) => r.registryNumber === "00004003"));

    // 5. Защита: опасные значения — только данные.
    const evil = "'; DROP TABLE \"RegistryRecord\"; --";
    const hostile = await store.search({ registryKind: "gisp_rpp_719", nameWords: [evil, "кресло"], enterpriseWords: [evil], modelRef: evil, standardRef: evil, inn: evil, okpd2Prefix: evil, limit: 5 });
    assert.equal(hostile.records.length, 0);
    assert.ok(await store.getByNumber("gisp_rpp_719", "00004001"), "таблица на месте");
    assert.equal(await store.getByNumber("gisp_rpp_719", "' OR 1=1 --"), null);

    // 6. Решение поверх настоящего поиска.
    const card = applyEdits({ key: "1:x", name: "Кресло офисное", quantity: "", source: "", quote: "", offeredName: null, fields: { okpd2: { value: "31.01.12.160", origin: "tz", source: "ТЗ" } } }, { inn: A.inn, model: "КО-1" });
    const decision = await resolveCard(store, card, { registry: "gisp_rpp_719", asOf: "2026-11-20", now: new Date("2026-10-12T00:00:00Z") });
    assert.equal(decision.status, "confirmed", decision.reasons.join(" | "));
    assert.equal(decision.proposed, "00004001");

    // 7. Изменения между выгрузками: записи → изменение, пропажа, возврат; журнал в базе.
    const changed = base.map((r) => (r === base[0] ? fixtureRow({ number: "00004001", ...A, name: "Кресло офисное тестовое КО-1 (новая редакция)" }) : r));
    const second = await imp("b", changed.filter((r) => r !== base[3]));
    assert.equal(second.report.recordsChanged, 1);
    assert.equal(second.report.recordsAbsent, 1, "стол 00004004 пропал из выгрузки");
    const stolen = await store.getByNumber("gisp_rpp_719", "00004004");
    assert.equal(stolen?.status, "absent");
    const history = await store.history(one.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].kind, "changed");
    assert.equal(history[0].before?.productName, "Кресло офисное тестовое КО-1");
    assert.match(String(history[0].after?.productName), /новая редакция/);
    const third = await imp("c", changed);
    assert.equal(third.report.recordsReturned, 1);
    assert.equal((await store.getByNumber("gisp_rpp_719", "00004004"))?.status, "active");
    const absentHistory = await store.history(stolen!.id);
    assert.deepEqual(absentHistory.map((h) => h.kind), ["absent", "returned"]);

    // 8. Последняя выгрузка.
    const latest = await store.latestDataset("gisp_rpp_719");
    assert.ok(latest && latest.status === "completed");
  } finally {
    // Подчищаем только свои строки: журнал → записи → выгрузки.
    const own = await db.registryDataset.findMany({ where: { fileSha256: { startsWith: stamp } }, select: { id: true } });
    const ids = [...own.map((d: { id: string }) => d.id), ...datasetIds];
    await db.registryChange.deleteMany({ where: { datasetId: { in: ids } } });
    await db.registryRecord.deleteMany({ where: { firstSeenDatasetId: { in: ids } } });
    await db.registryDataset.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    void FIXTURE_HEADER;
  }
});
