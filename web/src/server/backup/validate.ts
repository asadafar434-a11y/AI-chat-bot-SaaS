/**
 * Валидация восстановленного backup: счётчики таблиц против манифеста,
 * контрольные суммы объектов, согласованность документов БД и объектов.
 *
 * Это app-level проверка «данные эквивалентны ожидаемому состоянию», а не
 * просто «файлы существуют».
 */

import { readBackupManifest, readBackupPayload } from "./archive.ts";
import { OBJECT_KEYS_SQL } from "./object-keys.ts";
import { verifyObjects } from "./objects.ts";
import type { PgPort } from "./pg-port.ts";
import type { RestoreValidationReport } from "./types.ts";
import type { StorageAdapter } from "../storage/types.ts";

export type ValidateOptions = {
  pg: PgPort;
  manifestDatabaseCounts: Record<string, number> | null;
  targetDatabase: string;
  storage: StorageAdapter;
  backupDir: string;
  encryptionKey: Buffer;
};

function parseLines(out: string): string[] {
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function validateRestore(options: ValidateOptions): Promise<RestoreValidationReport> {
  const manifest = await readBackupManifest(options.backupDir);
  const payload = await readBackupPayload(options.backupDir, manifest, options.encryptionKey);

  const expected = options.manifestDatabaseCounts ?? manifest.database.tableCounts;
  const tableCounts: Record<string, { expected: number; actual: number; match: boolean }> = {};
  let countsMatch = true;
  for (const [table, want] of Object.entries(expected)) {
    const value = await options.pg.query(options.targetDatabase, `SELECT count(*) FROM "${table}"`);
    const actual = Number(value.trim());
    const match = actual === want;
    tableCounts[table] = { expected: want, actual, match };
    if (!match) {
      countsMatch = false;
    }
  }

  const objectsMatch = await verifyObjects(options.storage, payload.objects);

  const referencedKeys = parseLines(await options.pg.query(options.targetDatabase, OBJECT_KEYS_SQL));
  const objectKeys = new Set(payload.objects.map((o) => o.key));
  const missingObjects = referencedKeys.filter((key) => !objectKeys.has(key));
  const orphanObjects = payload.objects.map((o) => o.key).filter((key) => !referencedKeys.includes(key));
  const consistency = {
    missingObjects,
    orphanObjects,
    checksumMismatches: [] as string[],
    ok: missingObjects.length === 0 && orphanObjects.length === 0,
  };

  return {
    tableCounts,
    countsMatch,
    objectsMatch,
    consistency,
    ok: countsMatch && objectsMatch && consistency.ok,
  };
}
