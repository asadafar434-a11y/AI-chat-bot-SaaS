/**
 * CLI создания backup S9.
 *
 * Запуск (web/):
 *   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/test-alias.mjs scripts/backup-create.ts
 *
 * ENV:
 *   BACKUP_DATABASE        — имя БД-источника (обязательно)
 *   BACKUP_DIR             — каталог артефактов (по умолчанию ./backups)
 *   BACKUP_ENCRYPTION_KEY  — hex 64 (32 байта), ключ шифрования payload (обязательно)
 *   BACKUP_PG_CONTAINER    — docker-контейнер PostgreSQL (dev); иначе DATABASE_URL + pg_dump/psql
 *   BACKUP_PG_USER         — пользователь для docker-режима (по умолчанию postgres)
 *   STORAGE_*              — конфигурация S6-хранилища (fs/s3)
 *
 * Секреты не логируются. Ключ шифрования в манифест не попадает.
 */
import { join } from "node:path";

import { createBackup } from "../src/server/backup/create.ts";
import { parseEncryptionKey } from "../src/server/backup/crypto.ts";
import { createPgPort, pgPortConfigFromEnv } from "../src/server/backup/pg-port.ts";
import { createStorageAdapter } from "../src/server/storage/config.ts";

async function main(): Promise<void> {
  const database = (process.env.BACKUP_DATABASE ?? "").trim();
  if (!database) {
    throw new Error("backup-create: не задан BACKUP_DATABASE");
  }
  const dir = (process.env.BACKUP_DIR ?? "./backups").trim() || "./backups";
  const key = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
  const pg = createPgPort(pgPortConfigFromEnv());
  const storage = createStorageAdapter();

  const result = await createBackup({
    pg,
    database,
    storage,
    storageBackend: storage.backend,
    dir: join(dir),
    encryptionKey: key,
  });

  console.log(
    JSON.stringify(
      {
        event: "backup.created",
        backupId: result.manifest.backupId,
        dir: result.dir,
        tables: Object.keys(result.manifest.database.tableCounts).length,
        objects: result.manifest.objects.count,
        totalBytes: result.manifest.objects.totalBytes,
        validationOk: result.validation.ok,
        missingObjects: result.validation.missingObjects.length,
        orphanObjects: result.validation.orphanObjects.length,
        checksumMismatches: result.validation.checksumMismatches.length,
      },
      null,
      2,
    ),
  );
  if (!result.validation.ok) {
    console.error("backup-create: validation не прошла — backup неполный");
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(`backup-create: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
