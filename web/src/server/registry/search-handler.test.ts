// Маршрут поиска по реестру: доступ, проверка запроса, ответ, отказ без базы — npm test. База заменена памятью.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureRecord, seededStore } from "../../lib/registry-fixtures.ts";
import { createMemoryRegistryStore } from "../../lib/registry-store.ts";
import { handleRegistrySearch, type SearchDeps } from "./search-handler.ts";

const NOW = new Date("2026-10-12T09:00:00Z");
const A = { enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "АЛЬФА"', inn: "9900000001" };

const post = (body: unknown) =>
  new Request("http://localhost/api/registry/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

const item = (over: Record<string, unknown> = {}) => ({
  key: "1:abc",
  name: "Кресло офисное",
  quantity: "5 шт",
  fields: { okpd2: { value: "31.01.12.160", origin: "tz", source: "ТЗ" } },
  ...over,
});

async function deps(over: Partial<SearchDeps> = {}): Promise<SearchDeps> {
  const store = await seededStore([fixtureRecord({ registryNumber: "00003001", ...A, productName: "Кресло офисное тестовое КО-1" })]);
  return { authorize: async () => null, hasDatabase: () => true, getStore: () => store, now: () => NOW, ...over };
}

test("находит запись и возвращает решение с выгрузкой, фильтрами и допущениями", async () => {
  const res = await handleRegistrySearch(
    post({ registry: "gisp_rpp_719", asOf: "2026-11-20", items: [item({ fields: { inn: { value: "9900000001", origin: "user", source: "участник" }, model: { value: "КО-1", origin: "user", source: "участник" }, okpd2: { value: "31.01.12.160", origin: "tz", source: "ТЗ" } } })] }),
    await deps(),
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.results[0].key, "1:abc");
  assert.equal(json.results[0].decision.status, "confirmed");
  assert.equal(json.results[0].decision.proposed, "00003001");
  assert.ok(json.datasets[0].fileSha256);
  assert.equal(json.datasets[0].registry, "gisp_rpp_719");
  assert.ok(json.results[0].decision.assumptions.length > 0);
  assert.equal(JSON.stringify(json).includes("DATABASE_URL"), false);
});

test("без входа — отказ, поиск не выполняется", async () => {
  let searched = false;
  const store = createMemoryRegistryStore();
  const original = store.search;
  store.search = async (q) => ((searched = true), original(q));
  const res = await handleRegistrySearch(post({ registry: "gisp_rpp_719", items: [item()] }), await deps({ authorize: async () => new Response("Требуется вход", { status: 401 }), getStore: () => store }));
  assert.equal(res.status, 401);
  assert.equal(searched, false);
});

test("повреждённый запрос, неизвестный реестр и слишком много товаров — 400 с понятным текстом", async () => {
  const d = await deps();
  assert.equal((await handleRegistrySearch(post("{не json"), d)).status, 400);
  const unknown = await handleRegistrySearch(post({ registry: "другой", items: [item()] }), d);
  assert.equal(unknown.status, 400);
  assert.match(await unknown.text(), /реестр/);
  const many = await handleRegistrySearch(post({ registry: "gisp_rpp_719", items: Array.from({ length: 61 }, (_, i) => item({ key: `${i}:x` })) }), d);
  assert.equal(many.status, 400);
  const dup = await handleRegistrySearch(post({ registry: "gisp_rpp_719", items: [item(), item()] }), d);
  assert.equal(dup.status, 400);
  const noName = await handleRegistrySearch(post({ registry: "gisp_rpp_719", items: [item({ name: "  " })] }), d);
  assert.equal(noName.status, 400);
});

test("значения из запроса чистятся: управляющие символы, чужие поля, огромные тексты, SQL в названии", async () => {
  const evil = "'; DROP TABLE \"RegistryRecord\"; --";
  const res = await handleRegistrySearch(
    post({ registry: "gisp_rpp_719", items: [item({ name: `Кресло\u0000\u0007 офисное ${evil}`, fields: { manufacturer: { value: evil, origin: "user", source: "x" }, hack: { value: "1", origin: "user" }, model: { value: "A".repeat(10000), origin: "user" } } })] }),
    await deps(),
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.results.length, 1);
  assert.ok(["not_found", "need_data", "contradiction", "choose"].includes(json.results[0].decision.status));
});

test("без базы — 503 и понятный текст, а не падение", async () => {
  const res = await handleRegistrySearch(post({ registry: "gisp_rpp_719", items: [item()] }), await deps({ hasDatabase: () => false }));
  assert.equal(res.status, 503);
  assert.match(await res.text(), /База реестра не подключена/);
});

test("база упала посреди поиска — 503, в ответ не просачивается внутренняя ошибка", async () => {
  const broken = createMemoryRegistryStore();
  broken.latestDataset = async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:5432 password=секрет');
  };
  const res = await handleRegistrySearch(post({ registry: "gisp_rpp_719", items: [item()] }), await deps({ getStore: () => broken }));
  assert.equal(res.status, 503);
  const body = await res.text();
  assert.match(body, /сейчас недоступна/);
  assert.equal(body.includes("секрет"), false);
});

test("реестр не загружен — ответ «данные реестра не загружены», номер не придумывается", async () => {
  const res = await handleRegistrySearch(post({ registry: "gisp_rpp_719", items: [item()] }), await deps({ getStore: () => createMemoryRegistryStore() }));
  const json = await res.json();
  assert.deepEqual(json.datasets, []);
  assert.equal(json.results[0].decision.status, "no_dataset");
  assert.equal(json.results[0].decision.proposed, null);
});

test("пустой список товаров — ответ с описанием выгрузки без поиска", async () => {
  const res = await handleRegistrySearch(post({ registry: "gisp_rpp_719", items: [] }), await deps());
  const json = await res.json();
  assert.deepEqual(json.results, []);
  assert.ok(json.datasets[0].exportedAt);
});

test("реестр в запросе можно не называть: ищем сразу во всех загруженных, а неизвестное название реестра — отказ", async () => {
  const d = await deps();
  const res = await handleRegistrySearch(post({ items: [item()] }), d);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).registry, null);
  const bad = await handleRegistrySearch(post({ registry: "другой", items: [item()] }), d);
  assert.equal(bad.status, 400);
});

test("дата подачи по умолчанию — сегодня, а неверная дата заменяется на сегодня", async () => {
  const res = await handleRegistrySearch(post({ registry: "gisp_rpp_719", asOf: "31.31.2026", items: [item()] }), await deps());
  assert.equal((await res.json()).asOf, "2026-10-12");
});

test("одно из многих: ошибка в запросе одного товара не отдаёт чужие данные, все решения независимы", async () => {
  const res = await handleRegistrySearch(
    post({
      registry: "gisp_rpp_719",
      items: [
        item({ key: "1:a", fields: { inn: { value: "9900000001", origin: "user" }, model: { value: "КО-1", origin: "user" }, okpd2: { value: "31.01.12.160", origin: "tz" } } }),
        item({ key: "2:b", name: "Кресло офисное", fields: { inn: { value: "9900000001", origin: "user" }, model: { value: "ЗЕТ-5", origin: "user" }, okpd2: { value: "31.01.12.160", origin: "tz" } } }),
      ],
    }),
    await deps(),
  );
  const json = await res.json();
  assert.equal(json.results[0].decision.status, "confirmed");
  assert.equal(json.results[1].decision.status, "contradiction");
  assert.equal(json.results[1].decision.proposed, null);
});

test("поиск идёт сразу в обоих реестрах: запись только РЭП и запись только РПП находятся без указания реестра, в ответе — обе выгрузки", async () => {
  const store = createMemoryRegistryStore();
  await seededStore([fixtureRecord({ registryNumber: "00003001", ...A, productName: "Кресло офисное тестовое КО-1" })], undefined, "gisp_rpp_719", store);
  await seededStore(
    [fixtureRecord({ registryKind: "gisp_rep_878", registryNumber: "00003777", enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "РАДИО"', inn: "9900000077", productName: "Тестовый коммутатор КМ-1", okpd2: "26.30.11.110", flags: { ai: false, highTech: false, trustedPak: false, radioLevel: "Уровень 1" } })],
    "2026-10-11T22:00:10.000Z",
    "gisp_rep_878",
    store,
  );
  const d = await deps({ getStore: () => store });
  const ask = (name: string, inn: string, model: string) =>
    handleRegistrySearch(post({ asOf: "2026-11-20", items: [item({ name, fields: { inn: { value: inn, origin: "user", source: "участник" }, model: { value: model, origin: "user", source: "участник" } } })] }), d).then((r) => r.json());

  const radio = await ask("Коммутатор", "9900000077", "КМ-1");
  assert.equal(radio.results[0].decision.status, "confirmed");
  assert.equal(radio.results[0].decision.proposed, "00003777");
  assert.equal(radio.results[0].decision.candidates[0].registryKind, "gisp_rep_878");
  assert.equal(radio.results[0].decision.candidates[0].radioLevel, "Уровень 1");
  assert.deepEqual(radio.datasets.map((x: { registry: string }) => x.registry), ["gisp_rpp_719", "gisp_rep_878"]);

  const chair = await ask("Кресло офисное", "9900000001", "КО-1");
  assert.equal(chair.results[0].decision.proposed, "00003001");
  assert.equal(chair.results[0].decision.candidates[0].registryKind, "gisp_rpp_719");
});
