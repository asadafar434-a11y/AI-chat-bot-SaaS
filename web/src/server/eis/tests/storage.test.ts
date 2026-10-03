// EIS Collector v1: unit-тесты хранилища (hash, dedup, manifest, прогресс, валидация). Запуск: npm test.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildManifest,
  loadHashIndex,
  loadProgress,
  markCompleted,
  resolveTenderDir,
  safeFileName,
  sha256Hex,
  storeRawFile,
  validateDataset,
  writeManifest,
  writeTenderSnapshot,
} from "../storage.ts";

const freshRoot = (): string => mkdtempSync(join(tmpdir(), "eis-storage-"));
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

test("storage: SHA-256 известного вектора", () => {
  assert.equal(sha256Hex(bytes("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("storage: запись + дедупликация (reused, без повторной записи)", () => {
  const root = freshRoot();
  const dirA = resolveTenderDir(root, "44fz", "0373100130926000001", new Date("2026-09-01T00:00:00Z"));
  assert.ok(dirA.includes(join("raw", "44fz", "2026", "09", "0373100130926000001")));
  const first = storeRawFile(root, dirA, "n.xml", bytes("content-1"), loadHashIndex(root));
  assert.equal(first.reused, false);
  assert.equal(first.size, 9);
  assert.match(first.sha256, /^[0-9a-f]{64}$/);
  assert.ok(existsSync(join(root, first.relativePath)));

  // Тот же контент для другой закупки — reused, связь через localPath.
  const index = loadHashIndex(root);
  const dirB = resolveTenderDir(root, "44fz", "0373100130926000002", new Date("2026-09-01T00:00:00Z"));
  const second = storeRawFile(root, dirB, "n.xml", bytes("content-1"), index);
  assert.equal(second.reused, true);
  assert.equal(second.relativePath, first.relativePath);
  assert.equal(second.sha256, first.sha256);
  // В каталоге второй закупки файл-дубликат не создан.
  assert.ok(!existsSync(join(dirB, "n.xml")));

  // Новый контент — пишется рядом.
  const third = storeRawFile(root, dirB, "m.xml", bytes("content-2"), index);
  assert.equal(third.reused, false);
  assert.ok(existsSync(join(root, third.relativePath)));
});

test("storage: пустой файл отклоняется", () => {
  const root = freshRoot();
  assert.throws(() => storeRawFile(root, resolveTenderDir(root, "44fz", "1", new Date()), "e.bin", bytes(""), {}), /размер 0/);
});

test("storage: safeFileName чистит опасные символы", () => {
  assert.equal(safeFileName("a/b", "..\\x?.xml"), "b__.._x_.xml");
});

test("storage: manifest roundtrip + validateDataset OK", () => {
  const root = freshRoot();
  const dir = resolveTenderDir(root, "44fz", "0373100130926000001", new Date("2026-09-01T00:00:00Z"));
  const stored = storeRawFile(root, dir, "n.xml", bytes("data"), {});
  const manifest = buildManifest("0373100130926000001", "44fz", { source: "test" }, [
    {
      tenderRegistryNumber: "0373100130926000001",
      law: "44fz",
      documentId: "n.xml",
      documentType: "documentXml",
      fileName: "n.xml",
      downloadedAt: "2026-10-03T00:00:00.000Z",
      sha256: stored.sha256,
      size: stored.size,
      localPath: stored.relativePath,
    },
  ]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.collectorVersion, "0.1.0");
  writeManifest(dir, manifest);
  writeTenderSnapshot(dir, { registryNumber: "0373100130926000001" });
  const readBack = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as typeof manifest;
  assert.equal(readBack.tenderRegistryNumber, "0373100130926000001");
  assert.deepEqual(validateDataset(root, manifest, dir), []);
});

test("storage: validateDataset находит проблемы (дубликат, нет hash, нет файла)", () => {
  const root = freshRoot();
  const dir = resolveTenderDir(root, "44fz", "0373100130926000001", new Date("2026-09-01T00:00:00Z"));
  const manifest = buildManifest("0373100130926000001", "44fz", {}, [
    {
      tenderRegistryNumber: "0373100130926000001",
      law: "44fz",
      documentId: "dup",
      documentType: "file.bin",
      fileName: "dup",
      downloadedAt: "2026-10-03T00:00:00.000Z",
      sha256: "0".repeat(64),
      size: 5,
      localPath: "raw/44fz/2026/09/0373100130926000001/dup",
    },
    {
      tenderRegistryNumber: "0373100130926000001",
      law: "44fz",
      documentId: "dup",
      documentType: "file.bin",
      fileName: "dup2",
      downloadedAt: "2026-10-03T00:00:00.000Z",
    },
  ]);
  const problems = validateDataset(root, manifest, dir);
  assert.ok(problems.some((p) => p.includes("дубликат")));
  assert.ok(problems.some((p) => p.includes("SHA-256")));
  assert.ok(problems.some((p) => p.includes("отсутствует на диске")));
  assert.ok(problems.some((p) => p.includes("manifest.json")));
});

test("storage: прогресс переживает перезапуск", () => {
  const root = freshRoot();
  assert.deepEqual(loadProgress(root).completed, {});
  markCompleted(root, "0373100130926000001");
  assert.ok(loadProgress(root).completed["0373100130926000001"]);
});
