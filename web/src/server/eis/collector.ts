/**
 * EIS Collector v1 — оркестратор pipeline:
 * Discovery -> registry numbers -> document metadata -> downloader ->
 * RAW storage -> SHA-256 dedup -> normalized metadata -> dataset.
 *
 * Свойства: timeout/retry — в client.ts; здесь — rate-limit паузa между
 * закупками, изоляция ошибок одной закупки (не роняет весь запуск),
 * идемпотентный повторный запуск (progress.json + hash-индекс), dry-run
 * без скачивания файлов, структурированные JSON-логи без секретов.
 */

import { EisHttpClient } from "./client.ts";
import type { EisConfig } from "./config.ts";
import { createAdapter, type EisAdapter } from "./discovery.ts";
import { errorText } from "./errors.ts";
import { buildNormalizedTender, toObjectiveFields, writeNormalized } from "./normalize.ts";
import {
  buildManifest,
  loadHashIndex,
  loadProgress,
  markCompleted,
  resolveTenderDir,
  safeFileName,
  storeRawFile,
  validateDataset,
  writeManifest,
  writeTenderSnapshot,
} from "./storage.ts";
import type {
  EisCollectorStats,
  EisDiscoveryFilters,
  EisDocumentMetadata,
  EisLogRecord,
} from "./types.ts";

export type EisLogger = (record: EisLogRecord) => void;

export interface RunCollectorOptions {
  config: EisConfig;
  filters: EisDiscoveryFilters;
  /** Переопределение maxTenders поверх ENV (CLI --max-tenders). */
  maxTenders?: number;
  /** Переопределение dryRun поверх ENV (CLI --dry-run / --live). */
  dryRun?: boolean;
  /** Инжекция адаптера (тесты подставляют mock; по умолчанию — по law). */
  adapter?: EisAdapter;
  /** Инжекция логгера (по умолчанию — JSON в stdout). */
  logger?: EisLogger;
  /** Текущее время (тесты фиксируют для детерминированных путей). */
  now?: Date;
}

const defaultLogger: EisLogger = (record) => {
  console.log(JSON.stringify(record));
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function runCollector(opts: RunCollectorOptions): Promise<EisCollectorStats> {
  const { config } = opts;
  const log = opts.logger ?? defaultLogger;
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? config.dryRun;
  const maxTenders = opts.maxTenders ?? config.maxTenders;
  const startedAt = now.toISOString();

  const emit = (record: Omit<EisLogRecord, "timestamp">): void => {
    log({ ...record, timestamp: new Date().toISOString() });
  };

  emit({ level: "info", event: "collector.start", law: opts.filters.law, detail: { dryRun, maxTenders } });

  const client = new EisHttpClient(config);
  const adapter = opts.adapter ?? createAdapter(opts.filters.law, client, config.authToken);

  const stats: EisCollectorStats = {
    dryRun,
    law: opts.filters.law,
    found: 0,
    toProcess: 0,
    succeeded: 0,
    failed: 0,
    documentsExpected: 0,
    documentsDownloaded: 0,
    documentsReused: 0,
    processedRegistryNumbers: [],
    failures: {},
    startedAt,
    finishedAt: startedAt,
  };

  // Уже завершённые в прошлых запусках пропускаем (идемпотентность).
  const progress = loadProgress(config.storagePath);

  let discovered;
  try {
    discovered = await adapter.discoverTenders(opts.filters, maxTenders);
  } catch (err) {
    emit({ level: "error", event: "discovery.failed", law: opts.filters.law, detail: { error: errorText(err) } });
    throw err;
  }
  stats.found = discovered.length;
  // Сначала исключаем уже завершённые (идемпотентный рестарт), затем режем лимитом:
  // maxTenders — «сколько обработать за этот запуск», а не «сколько первых из discovery».
  const queue = discovered.filter((t) => !progress.completed[t.registryNumber]).slice(0, maxTenders);
  stats.toProcess = queue.length;
  stats.processedRegistryNumbers = queue.map((t) => t.registryNumber);
  emit({
    level: "info",
    event: "discovery.done",
    law: opts.filters.law,
    detail: { found: stats.found, toProcess: stats.toProcess, skippedCompleted: discovered.length - queue.length },
  });

  const hashIndex = loadHashIndex(config.storagePath);

  for (const tender of queue) {
    try {
      const docs = await adapter.getTenderDocuments(tender);
      stats.documentsExpected += docs.length;
      emit({
        level: "info",
        event: dryRun ? "tender.planned" : "tender.documents",
        registryNumber: tender.registryNumber,
        law: tender.law,
        detail: { documents: docs.length },
      });
      if (dryRun) {
        stats.succeeded += 1;
        continue;
      }
      const result = await downloadAndStore(config, tender.registryNumber, tender.law, docs, adapter, hashIndex, now, emit);
      stats.documentsDownloaded += result.downloaded;
      stats.documentsReused += result.reused;
      markCompleted(config.storagePath, tender.registryNumber);
      stats.succeeded += 1;
    } catch (err) {
      // Одна закупка не роняет весь запуск.
      stats.failed += 1;
      stats.failures[tender.registryNumber] = errorText(err);
      emit({ level: "error", event: "tender.failed", registryNumber: tender.registryNumber, law: tender.law, detail: { error: errorText(err) } });
    }
    if (config.requestDelayMs > 0) await delay(config.requestDelayMs);
  }

  stats.finishedAt = new Date().toISOString();
  emit({
    level: "info",
    event: "collector.done",
    law: opts.filters.law,
    detail: {
      found: stats.found,
      toProcess: stats.toProcess,
      succeeded: stats.succeeded,
      failed: stats.failed,
      documentsExpected: stats.documentsExpected,
      documentsDownloaded: stats.documentsDownloaded,
      documentsReused: stats.documentsReused,
    },
  });
  return stats;
}

async function downloadAndStore(
  config: EisConfig,
  registryNumber: string,
  law: EisDiscoveryFilters["law"],
  docs: EisDocumentMetadata[],
  adapter: EisAdapter,
  hashIndex: Record<string, string>,
  now: Date,
  emit: (record: Omit<EisLogRecord, "timestamp">) => void,
): Promise<{ docs: EisDocumentMetadata[]; downloaded: number; reused: number }> {
  const tenderDir = resolveTenderDir(config.storagePath, law, registryNumber, now);
  const enriched: EisDocumentMetadata[] = [];
  let downloaded = 0;
  let reused = 0;
  for (const doc of docs) {
    const { bytes, contentType } = await adapter.downloadDocument(doc);
    const stored = storeRawFile(config.storagePath, tenderDir, safeFileName(doc.documentId, doc.fileName), bytes, hashIndex);
    if (stored.reused) reused += 1;
    else downloaded += 1;
    enriched.push({
      ...doc,
      contentType: contentType ?? doc.contentType,
      sha256: stored.sha256,
      size: stored.size,
      localPath: stored.relativePath,
      reused: stored.reused || undefined,
    });
  }
  // manifest + snapshot + normalized + валидация качества.
  const manifest = buildManifest(registryNumber, law, { source: "eis-soi" }, enriched);
  writeManifest(tenderDir, manifest);
  writeTenderSnapshot(tenderDir, {
    registryNumber,
    law,
    documents: enriched.length,
    collectedAt: manifest.collectedAt,
    collectorVersion: manifest.collectorVersion,
  });
  const normalized = buildNormalizedTender({ registryNumber, law, objective: toObjectiveFields(undefined), documents: enriched });
  writeNormalized(config.storagePath, law, registryNumber, normalized, now);
  const problems = validateDataset(config.storagePath, manifest, tenderDir);
  if (problems.length > 0) {
    throw new Error(`Валидация dataset не пройдена: ${problems.join("; ")}`);
  }
  emit({
    level: "info",
    event: "tender.stored",
    registryNumber,
    law,
    detail: { documents: enriched.length, downloaded, reused },
  });
  return { docs: enriched, downloaded, reused };
}
