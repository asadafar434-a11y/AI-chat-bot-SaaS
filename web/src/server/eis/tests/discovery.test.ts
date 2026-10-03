// EIS Collector v1: unit-тесты discovery (конверты, дни, адаптеры). Запуск: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EisHttpClient } from "../client.ts";
import {
  buildOrgRegionEnvelope,
  buildReestrNumberEnvelope,
  createAdapter,
  Eis223Adapter,
  Eis44Adapter,
  enumerateDays,
} from "../discovery.ts";
import { EisError } from "../errors.ts";
import { mockFetchSequence, soapArchiveResponse, soapDiscoveryResponse } from "./helpers.ts";

const cfg = () => ({
  baseUrl: "https://mock.invalid/soap",
  authToken: "tok",
  dryRun: true,
  maxTenders: 10,
  requestDelayMs: 0,
  maxRetries: 0,
  timeoutMs: 1000,
  storagePath: "./data-test",
});

test("discovery: порядок selectionParams и экранирование", () => {
  const xml = buildOrgRegionEnvelope({ token: "t&<k", region: "77", documentType44: "epX", exactDate: "2026-09-01" });
  const order = ["orgRegion", "subsystemType", "documentType44", "periodInfo"].map((t) => xml.indexOf(`<${t}>`));
  assert.ok(order.every((i) => i >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(xml.includes("t&amp;&lt;k"));
  assert.ok(xml.includes("<mode>PROD</mode>"));
});

test("discovery: reestrNumber-конверт валидирует номер", () => {
  const xml = buildReestrNumberEnvelope({ token: "t", registryNumber: "0373100130926000001" });
  assert.ok(xml.includes("<reestrNumber>0373100130926000001</reestrNumber>"));
  assert.throws(() => buildReestrNumberEnvelope({ token: "t", registryNumber: "bad" }), /Некорректный registry number/);
});

test("discovery: enumerateDays (один день, диапазон, лимит)", () => {
  assert.deepEqual(enumerateDays("2026-09-01", "2026-09-01"), ["2026-09-01"]);
  assert.deepEqual(enumerateDays("2026-09-01", "2026-09-03"), ["2026-09-01", "2026-09-02", "2026-09-03"]);
  assert.deepEqual(enumerateDays(undefined, undefined), []);
  assert.deepEqual(enumerateDays("2026-09-02", undefined), ["2026-09-02"]);
  assert.throws(() => enumerateDays("2026-09-05", "2026-09-01"), /Некорректный диапазон/);
  assert.throws(() => enumerateDays("2026-01-01", "2026-03-15"), /превышает лимит/);
});

test("discovery: 44-ФЗ sync-режим возвращает registry numbers с лимитом", async () => {
  const { fetchFn } = mockFetchSequence([{ body: soapDiscoveryResponse(["0373100130926000001", "0373100130926000002"]) }]);
  const adapter = new Eis44Adapter(new EisHttpClient(cfg(), fetchFn), "tok");
  const refs = await adapter.discoverTenders({ law: "44fz", dateFrom: "2026-09-01", dateTo: "2026-09-01" }, 1);
  assert.deepEqual(refs.map((r) => r.registryNumber), ["0373100130926000001"]);
});

test("discovery: 44-ФЗ archive-режим докачивает архив и ищет номера в нём", async () => {
  const { fetchFn, calls } = mockFetchSequence([
    { body: soapArchiveResponse("https://mock.invalid/a.zip") },
    { body: soapDiscoveryResponse(["32312304715"]) },
  ]);
  const adapter = new Eis44Adapter(new EisHttpClient(cfg(), fetchFn), "tok");
  const refs = await adapter.discoverTenders({ law: "44fz" }, 10);
  assert.deepEqual(refs.map((r) => r.registryNumber), ["32312304715"]);
  assert.equal(calls[1], "https://mock.invalid/a.zip");
});

test("discovery: getTenderDocuments из sync-ответа без archiveUrl", async () => {
  const { fetchFn } = mockFetchSequence([{ body: soapDiscoveryResponse(["0373100130926000001"]) }]);
  const adapter = new Eis44Adapter(new EisHttpClient(cfg(), fetchFn), "tok");
  const docs = await adapter.getTenderDocuments({ registryNumber: "0373100130926000001", law: "44fz" });
  assert.equal(docs.length, 1);
  assert.equal(docs[0]?.documentId, "0373100130926000001.xml");
  // downloadDocument отдаёт те же байты без повторного HTTP-запроса.
  const dl = await adapter.downloadDocument(docs[0]!);
  assert.ok(dl.bytes.length > 0);
});

test("discovery: 223-ФЗ — архитектурная заглушка NOT_IMPLEMENTED", async () => {
  const adapter = new Eis223Adapter();
  await assert.rejects(() => adapter.discoverTenders({ law: "223fz" }, 10), (err: unknown) => {
    assert.ok(err instanceof EisError && err.code === "NOT_IMPLEMENTED");
    assert.ok(!err.retryable);
    return true;
  });
  await assert.rejects(() => adapter.getTenderDocuments({ registryNumber: "32312304715", law: "223fz" }), /223-ФЗ/);
});

test("discovery: createAdapter выбирает по law", () => {
  const client = new EisHttpClient(cfg(), mockFetchSequence([{ body: "" }]).fetchFn);
  assert.ok(createAdapter("44fz", client, "t") instanceof Eis44Adapter);
  assert.ok(createAdapter("223fz", client, "t") instanceof Eis223Adapter);
});
