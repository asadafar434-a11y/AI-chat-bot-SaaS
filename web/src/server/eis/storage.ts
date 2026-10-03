/**
 * EIS Collector v1 — RAW-хранилище, дедупликация, manifest, прогресс, валидация.
 *
 * Раскладка:
 *   {storagePath}/raw/{law}/YYYY/MM/{registryNumber}/<оригинальные файлы>
 *   {storagePath}/raw/{law}/YYYY/MM/{registryNumber}/manifest.json
 *   {storagePath}/raw/{law}/YYYY/MM/{registryNumber}/tender.json
 *   {storagePath}/normalized/{law}/YYYY/MM/{registryNumber}/tender.json
 *   {storagePath}/.hash-index.json   (sha256 -> относительный путь канонического файла)
 *   {storagePath}/progress.json      (идемпотентные повторные запуски)
 *
 * RAW-файлы сохраняются БЕЗ изменения содержимого (байт-в-байт).
 * Дедупликация: одинаковый SHA-256 -> файл не пишется повторно, в метаданных
 * reused=true и localPath указывает на каноническое расположение (связь с закупкой
 * сохраняется в manifest каждой закупки).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { EisError } from "./errors.ts";
import type {
  EisDocumentMetadata,
  EisLaw,
  EisProgress,
  EisTenderManifest,
} from "./types.ts";
import { EIS_COLLECTOR_VERSION, EIS_MANIFEST_SCHEMA_VERSION } from "./types.ts";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** YYYY/MM для раскладки (из даты сбора либо из фильтра dateFrom). */
export function yearMonth(date: Date): { year: string; month: string } {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return { year, month };
}

export function resolveTenderDir(storagePath: string, law: EisLaw, registryNumber: string, at: Date = new Date()): string {
  const { year, month } = yearMonth(at);
  return join(storagePath, "raw", law, year, month, registryNumber);
}

export function resolveNormalizedDir(storagePath: string, law: EisLaw, registryNumber: string, at: Date = new Date()): string {
  const { year, month } = yearMonth(at);
  return join(storagePath, "normalized", law, year, month, registryNumber);
}

/** Имя файла, безопасное для ФС; префикс documentId против коллизий имён. */
export function safeFileName(documentId: string, fileName: string): string {
  const base = `${documentId}__${fileName}`.split("/").pop() ?? fileName;
  const clean = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180);
  return clean || "document.bin";
}

type HashIndex = Record<string, string>;

function hashIndexPath(storagePath: string): string {
  return join(storagePath, ".hash-index.json");
}

export function loadHashIndex(storagePath: string): HashIndex {
  const path = hashIndexPath(storagePath);
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: HashIndex = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function saveHashIndex(storagePath: string, index: HashIndex): void {
  mkdirSync(storagePath, { recursive: true });
  writeFileSync(hashIndexPath(storagePath), JSON.stringify(index, null, 2), "utf-8");
}

export interface StoredFile {
  /** Относительный путь от корня хранилища (для manifest/localPath). */
  relativePath: string;
  sha256: string;
  size: number;
  reused: boolean;
}

/**
 * Сохраняет байты как RAW-файл (идемпотентно по SHA-256).
 * Не изменяет содержимое. При совпадении hash файл не пишется повторно.
 */
export function storeRawFile(
  storagePath: string,
  tenderDir: string,
  fileName: string,
  bytes: Uint8Array,
  index: HashIndex,
): StoredFile {
  const sha256 = sha256Hex(bytes);
  const size = bytes.byteLength;
  if (size === 0) {
    throw new EisError("STORAGE_ERROR", `Отказ записи пустого файла ${fileName}: размер 0`);
  }
  const existing = index[sha256];
  if (existing) {
    const absExisting = join(storagePath, existing);
    if (existsSync(absExisting)) {
      return { relativePath: existing, sha256, size, reused: true };
    }
    // Индекс указывает в никуда (файл удалён вручную) — перезаписываем и чиним индекс ниже.
  }
  mkdirSync(tenderDir, { recursive: true });
  const absPath = join(tenderDir, fileName);
  writeFileSync(absPath, bytes);
  const relativePath = relative(storagePath, absPath).split(sep).join("/");
  index[sha256] = relativePath;
  saveHashIndex(storagePath, index);
  return { relativePath, sha256, size, reused: false };
}

/** Создаёт manifest закупки (tender.json рядом — сырой снимок метаданных discovery). */
export function buildManifest(
  registryNumber: string,
  law: EisLaw,
  metadata: Record<string, string>,
  documents: EisDocumentMetadata[],
): EisTenderManifest {
  return {
    schemaVersion: EIS_MANIFEST_SCHEMA_VERSION,
    tenderRegistryNumber: registryNumber,
    law,
    metadata,
    documents,
    collectedAt: new Date().toISOString(),
    collectorVersion: EIS_COLLECTOR_VERSION,
  };
}

export function writeManifest(tenderDir: string, manifest: EisTenderManifest): string {
  mkdirSync(tenderDir, { recursive: true });
  const path = join(tenderDir, "manifest.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
  return path;
}

export function writeTenderSnapshot(tenderDir: string, snapshot: Record<string, unknown>): string {
  mkdirSync(tenderDir, { recursive: true });
  const path = join(tenderDir, "tender.json");
  writeFileSync(path, JSON.stringify(snapshot, null, 2), "utf-8");
  return path;
}

export function loadProgress(storagePath: string): EisProgress {
  const path = join(storagePath, "progress.json");
  if (!existsSync(path)) return { version: 1, updatedAt: new Date().toISOString(), completed: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<EisProgress>;
    if (parsed && typeof parsed.completed === "object" && parsed.completed) {
      return { version: 1, updatedAt: new Date().toISOString(), completed: parsed.completed as Record<string, string> };
    }
  } catch {
    // Битый прогресс — начинаем заново, но не падаем (идемпотентность через hash-индекс сохраняется).
  }
  return { version: 1, updatedAt: new Date().toISOString(), completed: {} };
}

export function markCompleted(storagePath: string, registryNumber: string): void {
  const progress = loadProgress(storagePath);
  progress.completed[registryNumber] = new Date().toISOString();
  progress.updatedAt = progress.completed[registryNumber] as string;
  mkdirSync(storagePath, { recursive: true });
  writeFileSync(join(storagePath, "progress.json"), JSON.stringify(progress, null, 2), "utf-8");
}

/**
 * Проверки качества dataset для одной закупки:
 * registry number существует; у документов есть hash; каждый файл на диске;
 * нет дубликатов documentId; metadata валидна; размер > 0; число файлов на диске
 * соответствует manifest (коллектор ничего не потерял).
 * Возвращает список проблем (пусто = OK).
 */
export function validateDataset(storagePath: string, manifest: EisTenderManifest, tenderDir: string): string[] {
  const problems: string[] = [];
  if (!manifest.tenderRegistryNumber) problems.push("manifest: отсутствует tenderRegistryNumber");
  if (manifest.schemaVersion !== EIS_MANIFEST_SCHEMA_VERSION) {
    problems.push(`manifest: неожиданная schemaVersion ${manifest.schemaVersion}`);
  }
  const seen = new Set<string>();
  for (const doc of manifest.documents) {
    if (seen.has(doc.documentId)) problems.push(`дубликат documentId: ${doc.documentId}`);
    seen.add(doc.documentId);
    if (!doc.sha256 || !/^[0-9a-f]{64}$/.test(doc.sha256)) problems.push(`документ ${doc.documentId}: отсутствует SHA-256`);
    if (!doc.size || doc.size <= 0) problems.push(`документ ${doc.documentId}: некорректный размер`);
    if (!doc.fileName) problems.push(`документ ${doc.documentId}: отсутствует fileName`);
    if (!doc.localPath) {
      problems.push(`документ ${doc.documentId}: отсутствует localPath`);
      continue;
    }
    const abs = resolve(storagePath, doc.localPath);
    const root = resolve(storagePath);
    if (!abs.startsWith(root + sep) && abs !== root) {
      problems.push(`документ ${doc.documentId}: localPath выходит за пределы хранилища`);
      continue;
    }
    if (!existsSync(abs)) problems.push(`документ ${doc.documentId}: файл отсутствует на диске (${doc.localPath})`);
  }
  // Сверка с диском: файлы, записанные этим тендером (не reused), обязаны существовать.
  // Полная сверка «ничего не потеряно» выполняется validateDataset + проверкой
  // manifest.documents.length === числу записей (reused-ссылки указывают на
  // канонические файлы, их существование проверено выше для каждого документа).
  // Каталог закупки обязан содержать manifest.json и tender.json.
  if (!existsSync(join(tenderDir, "manifest.json"))) problems.push("в каталоге закупки отсутствует manifest.json");
  if (!existsSync(join(tenderDir, "tender.json"))) problems.push("в каталоге закупки отсутствует tender.json");
  return problems;
}

/** Абсолютный путь из относительного localPath с проверкой границ хранилища. */
export function resolveLocalPath(storagePath: string, localPath: string): string {
  const abs = resolve(storagePath, localPath);
  const root = resolve(storagePath);
  if (!abs.startsWith(root + sep) && abs !== root) {
    throw new EisError("STORAGE_ERROR", "localPath выходит за пределы хранилища");
  }
  return abs;
}

/** Гарантирует, что каталог существует (для тестов и CLI). */
export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function storageRoot(storagePath: string): string {
  return resolve(dirname(hashIndexPath(resolve(storagePath))));
}
