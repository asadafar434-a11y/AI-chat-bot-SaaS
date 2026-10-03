// EIS Collector v1: unit-тесты normalize + integration-тесты collector на mock-адаптере. Запуск: npm test.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCollector, type EisLogger } from "../collector.ts";
import type { EisConfig } from "../config.ts";
import type { EisAdapter } from "../discovery.ts";
import { buildNormalizedTender, toObjectiveFields } from "../normalize.ts";
import type { EisDiscoveryFilters, EisDocumentMetadata, EisLogRecord, EisTenderRef } from "../types.ts";

test("normalize: только объективные поля, мусор отбрасывается", () => {
  const fields = toObjectiveFields({
    customer: "Заказчик",
    customerInn: "7701234567",
    price: "1 500 000,00 ₽",
    status: "active",
    bogus: "x",
  });
  assert.equal(fields.customer, "Заказчик");
  assert.equal(fields.customerInn, "7701234567");
  assert.equal(fields.price, 1500000);
  assert.equal((fields as Record<string, unknown>)["bogus"], undefined);
  assert.deepEqual(toObjectiveFields({ customerInn: "ABC", price: "много" }), {});
  assert.deepEqual(toObjectiveFields(undefined), {});
});

test("normalize: rawRefs уникальны", () => {
  const doc = (p?: string): EisDocumentMetadata => ({
    tenderRegistryNumber: "1",
    law: "44fz",
    documentId: p ?? "d",
    documentType: "f",
    fileName: "f",
    downloadedAt: "2026-10-03T00:00:00.000Z",
    localPath: p,
  });
  const tender = buildNormalizedTender({
    registryNumber: "0373100130926000001",
    law: "44fz",
    objective: {},
    documents: [doc("a"), doc("a"), doc(undefined)],
  });
  assert.deepEqual(tender.rawRefs, ["a"]);
  assert.equal(tender.schemaVersion, 1);
});

// ── Mock-адаптер ─────────────────────────────────────────────────────────────

interface MockDoc {
  id: string;
  fileName: string;
  bytes: string;
}

class MockAdapter implements EisAdapter {
  readonly law = "44fz" as const;
  readonly downloadedIds: string[] = [];
  failDocsFor = new Set<string>();
  private readonly tenders: Array<{ registry: string; docs: MockDoc[] }>;

  constructor(tenders: Array<{ registry: string; docs: MockDoc[] }>) {
    this.tenders = tenders;
  }

  async discoverTenders(filters: EisDiscoveryFilters, max: number): Promise<EisTenderRef[]> {
    return this.tenders.map((t) => ({ registryNumber: t.registry, law: filters.law })).slice(0, max);
  }

  async getTenderDocuments(tender: EisTenderRef): Promise<EisDocumentMetadata[]> {
    if (this.failDocsFor.has(tender.registryNumber)) throw new Error("mock docs failure");
    const t = this.tenders.find((x) => x.registry === tender.registryNumber);
    if (!t) throw new Error("unknown tender");
    const now = "2026-10-03T00:00:00.000Z";
    return t.docs.map((d) => ({
      tenderRegistryNumber: t.registry,
      law: "44fz" as const,
      documentId: d.id,
      documentType: "documentXml",
      fileName: d.fileName,
      downloadedAt: now,
    }));
  }

  async downloadDocument(doc: EisDocumentMetadata): Promise<{ bytes: Uint8Array; contentType?: string }> {
    this.downloadedIds.push(doc.documentId);
    const t = this.tenders.find((x) => x.registry === doc.tenderRegistryNumber);
    const d = t?.docs.find((x) => x.id === doc.documentId);
    if (!d) throw new Error("unknown doc");
    return { bytes: new TextEncoder().encode(d.bytes), contentType: "application/xml" };
  }
}

const REG_A = "0373100130926000001";
const REG_B = "0373100130926000002";

const mockConfig = (storagePath: string): EisConfig => ({
  baseUrl: "https://mock.invalid",
  authToken: "s3cr3t-adapter-token",
  dryRun: true,
  maxTenders: 100,
  requestDelayMs: 0,
  maxRetries: 0,
  timeoutMs: 1000,
  storagePath,
});

const collectLogs = (): { logger: EisLogger; records: EisLogRecord[] } => {
  const records: EisLogRecord[] = [];
  return { logger: (r) => records.push(r), records };
};

const mockTenders = () => [
  { registry: REG_A, docs: [{ id: "a.xml", fileName: "a.xml", bytes: "<a/>" }] },
  { registry: REG_B, docs: [{ id: "shared.xml", fileName: "shared.xml", bytes: "<a/>" }] }, // тот же контент — dedup
];

test("collector: dry-run не пишет файлы, но считает документы", async () => {
  const root = mkdtempSync(join(tmpdir(), "eis-dry-"));
  const adapter = new MockAdapter(mockTenders());
  const { logger, records } = collectLogs();
  const stats = await runCollector({
    config: mockConfig(root),
    filters: { law: "44fz", dateFrom: "2026-09-01", dateTo: "2026-09-02" },
    adapter,
    logger,
    now: new Date("2026-09-03T00:00:00Z"),
  });
  assert.equal(stats.dryRun, true);
  assert.equal(stats.found, 2);
  assert.equal(stats.toProcess, 2);
  assert.deepEqual(stats.processedRegistryNumbers, [REG_A, REG_B]);
  assert.equal(stats.documentsExpected, 2);
  assert.equal(stats.documentsDownloaded, 0);
  assert.equal(adapter.downloadedIds.length, 0);
  assert.ok(!existsSync(join(root, "raw")));
  const dumped = JSON.stringify(records);
  assert.ok(!dumped.includes("s3cr3t-adapter-token"));
});

test("collector: live-запуск пишет RAW/manifest/normalized + dedup shared-файла", async () => {
  const root = mkdtempSync(join(tmpdir(), "eis-live-"));
  const adapter = new MockAdapter(mockTenders());
  const { logger } = collectLogs();
  const stats = await runCollector({
    config: mockConfig(root),
    filters: { law: "44fz" },
    dryRun: false,
    adapter,
    logger,
    now: new Date("2026-09-03T00:00:00Z"),
  });
  assert.equal(stats.succeeded, 2);
  assert.equal(stats.failed, 0);
  assert.equal(stats.documentsDownloaded, 1);
  assert.equal(stats.documentsReused, 1);
  for (const reg of [REG_A, REG_B]) {
    const dir = join(root, "raw", "44fz", "2026", "09", reg);
    assert.ok(existsSync(join(dir, "manifest.json")), `manifest ${reg}`);
    assert.ok(existsSync(join(dir, "tender.json")), `tender ${reg}`);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as {
      documents: Array<{ sha256: string; localPath: string; size: number }>;
    };
    assert.equal(manifest.documents.length, 1);
    assert.match(manifest.documents[0]!.sha256, /^[0-9a-f]{64}$/);
    assert.ok(existsSync(join(root, manifest.documents[0]!.localPath)));
    const norm = join(root, "normalized", "44fz", "2026", "09", reg, "tender.json");
    assert.ok(existsSync(norm), `normalized ${reg}`);
  }
  // RAW байт-в-байт.
  const rawA = readFileSync(join(root, "raw", "44fz", "2026", "09", REG_A, "a.xml__a.xml"), "utf-8");
  assert.equal(rawA, "<a/>");
});

test("collector: повторный запуск идемпотентен (progress пропускает готовые)", async () => {
  const root = mkdtempSync(join(tmpdir(), "eis-idem-"));
  const adapter = new MockAdapter(mockTenders());
  const noop: EisLogger = () => {};
  await runCollector({ config: mockConfig(root), filters: { law: "44fz" }, dryRun: false, adapter, logger: noop });
  const second = await runCollector({ config: mockConfig(root), filters: { law: "44fz" }, dryRun: false, adapter, logger: noop });
  assert.equal(second.found, 2);
  assert.equal(second.toProcess, 0);
  assert.equal(second.succeeded, 0);
});

test("collector: одна битая закупка не роняет запуск", async () => {
  const root = mkdtempSync(join(tmpdir(), "eis-part-"));
  const adapter = new MockAdapter(mockTenders());
  adapter.failDocsFor.add(REG_B);
  const stats = await runCollector({
    config: mockConfig(root),
    filters: { law: "44fz" },
    dryRun: false,
    maxTenders: 10,
    adapter,
    logger: () => {},
  });
  assert.equal(stats.succeeded, 1);
  assert.equal(stats.failed, 1);
  assert.ok(stats.failures[REG_B]?.includes("mock docs failure"));
  // maxTenders режет очередь (на свежем root без прогресса — детерминированно первый).
  const freshRoot = mkdtempSync(join(tmpdir(), "eis-slice-"));
  const adapter2 = new MockAdapter(mockTenders());
  const sliced = await runCollector({
    config: mockConfig(freshRoot),
    filters: { law: "44fz" },
    dryRun: true,
    maxTenders: 1,
    adapter: adapter2,
    logger: () => {},
  });
  assert.equal(sliced.toProcess, 1);
  assert.deepEqual(sliced.processedRegistryNumbers, [REG_A]);
});
