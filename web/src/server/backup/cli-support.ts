/**
 * Сборка restore + validation из окружения (для CLI и операционного запуска).
 */

import { createStorageAdapter } from "../storage/config.ts";
import { parseEncryptionKey } from "./crypto.ts";
import { createPgPort, pgPortConfigFromEnv } from "./pg-port.ts";
import { restoreBackup } from "./restore.ts";
import type { RestoreResult, RestoreValidationReport } from "./types.ts";
import { validateRestore } from "./validate.ts";

export async function backupRestoreValidation(options: {
  backupDir: string;
  targetDatabase: string;
}): Promise<{ restored: RestoreResult; report: RestoreValidationReport }> {
  const encryptionKey = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
  const pg = createPgPort(pgPortConfigFromEnv());
  const storage = createStorageAdapter();

  const restored = await restoreBackup({
    pg,
    targetDatabase: options.targetDatabase,
    storage,
    backupDir: options.backupDir,
    encryptionKey,
  });
  const report = await validateRestore({
    pg,
    manifestDatabaseCounts: null,
    targetDatabase: options.targetDatabase,
    storage,
    backupDir: options.backupDir,
    encryptionKey,
  });
  return { restored, report };
}