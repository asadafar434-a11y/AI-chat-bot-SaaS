/**
 * Восстановление backup в изолированную цель.
 *
 * Порядок: пересоздать пустую БД → залить logical SQL → восстановить объекты
 * с проверкой checksum → пересчитать счётчики. Целевая БД создаётся заново
 * (`DROP ... WITH (FORCE)` + `CREATE`), поэтому restore не зависит от
 * предшествующего состояния и не смешивается с исходной БД.
 */

import { readBackupManifest, readBackupPayload } from "./archive.ts";
import { restoreObjects } from "./objects.ts";
import type { PgPort } from "./pg-port.ts";
import type { RestoreResult } from "./types.ts";
import type { StorageAdapter } from "../storage/types.ts";

export type RestoreOptions = {
  pg: PgPort;
  targetDatabase: string;
  storage: StorageAdapter;
  backupDir: string;
  encryptionKey: Buffer;
};

export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const manifest = await readBackupManifest(options.backupDir);
  const payload = await readBackupPayload(options.backupDir, manifest, options.encryptionKey);

  if (await options.pg.databaseExists(options.targetDatabase)) {
    await options.pg.dropDatabase(options.targetDatabase);
  }
  await options.pg.createDatabase(options.targetDatabase);
  await options.pg.execSql(options.targetDatabase, payload.databaseSql);

  const { restored, checksumsOk } = await restoreObjects(options.storage, payload.objects);

  const tables = await options.pg.listPublicTables(options.targetDatabase);
  const tableCounts: Record<string, number> = {};
  for (const table of tables) {
    const value = await options.pg.query(options.targetDatabase, `SELECT count(*) FROM "${table}"`);
    tableCounts[table] = Number(value.trim());
  }

  return {
    backupId: manifest.backupId,
    database: options.targetDatabase,
    tableCounts,
    objectsRestored: restored,
    objectChecksumsOk: checksumsOk,
  };
}
