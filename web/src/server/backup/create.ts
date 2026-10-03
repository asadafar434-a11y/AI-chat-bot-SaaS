/**
 * Создание backup: logical dump PostgreSQL + объекты S6 + manifest.
 *
 * `createBackup` НЕ притворяется атомарным снимком: сначала снимается SQL-дамп
 * БД, затем перечисляются объекты. Окно консистентности фиксируется в манифесте,
 * а `validation` сразу показывает расхождения (документ ссылается на объект,
 * которого нет; объект без ссылки; несовпавший checksum).
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { setChecksum } from "../import/canonical.ts";
import type { StorageAdapter } from "../storage/types.ts";
import { encryptPayload } from "./crypto.ts";
import { OBJECT_KEYS_SQL } from "./object-keys.ts";
import { collectObjects } from "./objects.ts";
import type { PgPort } from "./pg-port.ts";
import type { BackupManifest, BackupPayload, BackupValidation } from "./types.ts";

export type CreateBackupOptions = {
  pg: PgPort;
  database: string;
  storage: StorageAdapter;
  storageBackend: string;
  dir: string;
  encryptionKey: Buffer;
  now?: Date;
  appVersion?: string;
  backupId?: string;
};

export type CreateBackupResult = {
  manifest: BackupManifest;
  validation: BackupValidation;
  dir: string;
};

function parseLines(out: string): string[] {
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function tableCounts(pg: PgPort, database: string): Promise<Record<string, number>> {
  const tables = await pg.listPublicTables(database);
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const value = await pg.query(database, `SELECT count(*) FROM "${table}"`);
    counts[table] = Number(value.trim());
  }
  return counts;
}

export async function createBackup(options: CreateBackupOptions): Promise<CreateBackupResult> {
  const now = options.now ?? new Date();
  const backupId =
    options.backupId ?? `bk_${now.toISOString().replace(/[:.]/g, "-")}_${randomBytes(4).toString("hex")}`;
  const databaseAt = now.toISOString();

  const databaseSql = await options.pg.dumpSchema(options.database);
  const counts = await tableCounts(options.pg, options.database);
  const { objects, mismatches } = await collectObjects(options.storage);
  const objectsAt = new Date().toISOString();

  const referencedKeys = parseLines(await options.pg.query(options.database, OBJECT_KEYS_SQL));
  const objectKeys = new Set(objects.map((o) => o.key));
  const missingObjects = referencedKeys.filter((key) => !objectKeys.has(key));
  const orphanObjects = objects.map((o) => o.key).filter((key) => !referencedKeys.includes(key));
  const validation: BackupValidation = {
    missingObjects,
    orphanObjects,
    checksumMismatches: mismatches,
    ok: missingObjects.length === 0 && orphanObjects.length === 0 && mismatches.length === 0,
  };

  const payload: BackupPayload = { databaseSql, objects };
  const { ciphertext, iv, tag } = encryptPayload(payload, options.encryptionKey);
  const payloadSha256 = createHash("sha256").update(ciphertext).digest("hex");

  const dir = join(options.dir, backupId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "payload.enc"), ciphertext);

  const manifest: BackupManifest = {
    format: "tender-lawyer-backup",
    version: 1,
    backupId,
    createdAt: now.toISOString(),
    appVersion: options.appVersion ?? "stage-11-s9",
    source: { database: options.database, storageBackend: options.storageBackend },
    database: {
      tableCounts: counts,
      sqlSha256: createHash("sha256").update(databaseSql).digest("hex"),
      sqlBytes: Buffer.byteLength(databaseSql, "utf8"),
    },
    objects: {
      count: objects.length,
      totalBytes: objects.reduce((sum, o) => sum + o.size, 0),
      checksum: setChecksum(objects.map((o) => `${o.key}:${o.sha256}`)),
    },
    payload: {
      file: "payload.enc",
      sha256: payloadSha256,
      bytes: ciphertext.length,
      encryption: { algorithm: "aes-256-gcm", iv, tag },
    },
    consistency: {
      databaseAt,
      objectsAt,
      note:
        "БД и объектное хранилище снимаются последовательно, не атомарно; " +
        "расхождения выявляются полями missingObjects/orphanObjects/checksumMismatches при создании и restore",
    },
  };

  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { manifest, validation, dir };
}
