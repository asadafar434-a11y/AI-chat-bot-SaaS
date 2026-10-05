/**
 * S9 acceptance: реальный backup → restore → validation в изолированной среде.
 *
 * Полностью изолировано от параллельной работы: создаётся отдельная source-БД,
 * в неё применяются миграции, она наполняется, с неё снимается backup, затем
 * restore идёт в отдельную target-БД и отдельный каталог объектного хранилища.
 * Общая TEST DB и EIS-сессия не затрагиваются.
 *
 * Требует `TEST_DATABASE_URL` и доступный Docker-контейнер PostgreSQL
 * (`BACKUP_PG_CONTAINER`, по умолчанию `tender-lawyer-postgres`).
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";

import { FsStorageAdapter } from "../storage/fs.ts";
import { createBackup } from "./create.ts";
import { createPgPort, type PgPort } from "./pg-port.ts";
import { restoreBackup } from "./restore.ts";
import { validateRestore } from "./validate.ts";

const TEST = process.env.TEST_DATABASE_URL;
const CONTAINER = process.env.BACKUP_PG_CONTAINER ?? "tender-lawyer-postgres";
const KEY = Buffer.from("a".repeat(64), "hex");
const WEB_ROOT = resolve(fileURLToPath(import.meta.url), "../../../..");
const MIGRATIONS_DIR = join(WEB_ROOT, "prisma", "migrations");

const skip = TEST ? false : "TEST_DATABASE_URL не задан: интеграционная проверка пропущена";

const suffix = () => randomBytes(5).toString("hex");
const mkId = (t: string) => `c${t}${randomBytes(10).toString("hex")}`.slice(0, 25);

const created: { pg: PgPort; dbs: string[]; dirs: string[]; clients: PrismaClient[] } = {
  pg: null as unknown as PgPort,
  dbs: [],
  dirs: [],
  clients: [],
};

after(async () => {
  if (!TEST) {
    return;
  }
  for (const client of created.clients) {
    await client.$disconnect().catch(() => {});
  }
  for (const db of created.dbs) {
    await created.pg.dropDatabase(db).catch(() => {});
  }
  for (const dir of created.dirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

function urlFor(database: string): string {
  const url = new URL(TEST as string);
  url.pathname = `/${database}`;
  return url.toString();
}

async function applyMigrations(pg: PgPort, database: string): Promise<void> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((n) => /^\d/.test(n)).sort();
  for (const name of names) {
    const sql = await readFile(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
    await pg.execSql(database, sql);
  }
}

test("S9: backup → restore → validation эквивалентности в изолированной среде", { skip }, async () => {
  created.pg = createPgPort({ mode: "docker", container: CONTAINER, user: "postgres" });
  const pg = created.pg;

  const sourceDb = `s9_src_${suffix()}`;
  const targetDb = `s9_restore_${suffix()}`;
  created.dbs.push(sourceDb, targetDb);

  const artifactDir = await mkdtemp(join(tmpdir(), "s9-backup-"));
  const sourceStorageDir = await mkdtemp(join(tmpdir(), "s9-src-storage-"));
  const targetStorageDir = await mkdtemp(join(tmpdir(), "s9-dst-storage-"));
  created.dirs.push(artifactDir, sourceStorageDir, targetStorageDir);

  // 1. Изолированная source-БД со схемой.
  await pg.createDatabase(sourceDb);
  await applyMigrations(pg, sourceDb);

  const db = new PrismaClient({ datasources: { db: { url: urlFor(sourceDb) } } });
  created.clients.push(db);
  const storage = new FsStorageAdapter({ dir: sourceStorageDir, secret: "s9-src-secret" });

  // 2. Наполнение: организация, участник, закупка, документ + бинарник, образец,
  //    факт, профиль организации, audit event.
  const org = mkId("a");
  const user = mkId("b");
  const purchaseId = mkId("p");
  await db.organization.create({ data: { id: org, name: "S9 Org" } });
  await db.user.create({ data: { id: user, email: `s9-${suffix()}@example.test` } });
  await db.membership.create({ data: { organizationId: org, userId: user, role: "owner" } });
  await db.purchase.create({
    data: { id: purchaseId, organizationId: org, legacyId: "s9p", originalFormatVersion: 2, status: "draft", payload: { subject: "S9" }, createdByUserId: null },
  });
  const bytes = new TextEncoder().encode("содержимое документа S9");
  const storageKey = `org/${org}/doc/${mkId("d")}/abcdef0123456789abcdef0123456789`;
  const sha256 = (await import("../storage/sign.ts")).sha256HexBytes(bytes);
  await storage.putObject(storageKey, bytes, { contentType: "text/plain", sha256 });
  const documentId = mkId("d");
  await db.document.create({
    data: { id: documentId, organizationId: org, purchaseId, fileName: "s9.txt", mimeType: "text/plain", sizeBytes: bytes.length, sha256, storageKey, textKey: null, readError: null },
  });
  await db.organizationProfile.create({ data: { organizationId: org, fields: { fullName: "S9 Org" }, version: 1 } });
  await db.sample.create({ data: { organizationId: org, kinds: ["tp"], about: "образец", textKey: null } });
  await db.fact.create({ data: { organizationId: org, kind: "license", title: "Лицензия", fields: {}, measures: [], validity: {}, source: { type: "manual" }, origin: "human", confirmed: true } });
  await db.auditEvent.create({ data: { organizationId: org, actorUserId: user, action: "document.uploaded", entityType: "document", entityId: documentId, metadata: {} } });

  // 3. Backup.
  const createdAt = new Date("2026-10-03T12:00:00.000Z");
  const backup = await createBackup({
    pg,
    database: sourceDb,
    storage,
    storageBackend: "fs",
    dir: artifactDir,
    encryptionKey: KEY,
    now: createdAt,
  });

  assert.equal(backup.validation.ok, true, `validation backup: ${JSON.stringify(backup.validation)}`);
  assert.equal(backup.manifest.objects.count, 1, "один объект забэкаплен");
  assert.equal(backup.manifest.database.tableCounts.Organization, 1);
  assert.equal(backup.manifest.database.tableCounts.Document, 1);
  assert.equal(backup.manifest.database.tableCounts.AuditEvent, 1);

  // manifest не содержит секретов/URL/содержимого. (Подстроки «token»/«secret»
  // не проверяем: «VerificationToken» — легитимное имя таблицы.)
  const manifestText = JSON.stringify(backup.manifest).toLowerCase();
  for (const forbidden of ["password", "postgres:postgres", "http://", "https://", "backup_encryption_key"]) {
    assert.ok(!manifestText.includes(forbidden), `manifest не должен содержать ${forbidden}`);
  }

  // 4. Restore в чистую target-БД + отдельный каталог объектов.
  const targetStorage = new FsStorageAdapter({ dir: targetStorageDir, secret: "s9-dst-secret" });
  const restored = await restoreBackup({
    pg,
    targetDatabase: targetDb,
    storage: targetStorage,
    backupDir: backup.dir,
    encryptionKey: KEY,
  });
  assert.equal(restored.objectsRestored, 1);
  assert.equal(restored.objectChecksumsOk, true);

  // 5. Validation: счётчики, checksum объектов, согласованность документ↔объект.
  const report = await validateRestore({
    pg,
    manifestDatabaseCounts: null,
    targetDatabase: targetDb,
    storage: targetStorage,
    backupDir: backup.dir,
    encryptionKey: KEY,
  });
  assert.equal(report.countsMatch, true, `counts: ${JSON.stringify(report.tableCounts)}`);
  assert.equal(report.objectsMatch, true);
  assert.equal(report.consistency.ok, true, `consistency: ${JSON.stringify(report.consistency)}`);
  assert.equal(report.ok, true, "итоговая валидация восстановления");

  // 6. Данные действительно восстановлены (читаем target-БД приложением).
  const restoredDb = new PrismaClient({ datasources: { db: { url: urlFor(targetDb) } } });
  created.clients.push(restoredDb);
  const restoredOrg = await restoredDb.organization.findFirst({ where: { id: org } });
  assert.equal(restoredOrg?.name, "S9 Org");
  const restoredDoc = await restoredDb.document.findFirst({ where: { id: documentId } });
  assert.equal(restoredDoc?.sha256, sha256);
  const restoredObject = await targetStorage.getObject(restoredDoc?.storageKey as string);
  assert.ok(restoredObject);
  assert.equal((await import("../storage/sign.ts")).sha256HexBytes(restoredObject?.bytes as Uint8Array), sha256);
  const audit = await restoredDb.auditEvent.findFirst({ where: { organizationId: org } });
  assert.equal(audit?.action, "document.uploaded");
});
