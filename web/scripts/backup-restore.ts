/**
 * CLI восстановления backup S9 в изолированную target-БД.
 *
 * Запуск (web/):
 *   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/test-alias.mjs scripts/backup-restore.ts --backup-dir <dir> --target <db>
 *
 * Target-БД пересоздаётся (DROP ... WITH (FORCE) + CREATE): restore не зависит
 * от прежнего состояния. После восстановления выполняется app-level validation.
 *
 * ENV: STORAGE_* (целевое хранилище), BACKUP_ENCRYPTION_KEY, BACKUP_PG_CONTAINER /
 *      DATABASE_URL, BACKUP_PG_USER.
 */
import { backupRestoreValidation } from "../src/server/backup/cli-support.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string): string | null => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : (args[i + 1] ?? null);
  };
  const backupDir = value("backup-dir") ?? process.env.BACKUP_DIR ?? "";
  const target = value("target") ?? "";
  if (!backupDir || !target) {
    throw new Error("backup-restore: нужны --backup-dir <dir> и --target <db>");
  }

  const { restored, report } = await backupRestoreValidation({ backupDir, targetDatabase: target });
  console.log(JSON.stringify({ event: "backup.restored", target, restored, report }, null, 2));
  if (!report.ok) {
    console.error("backup-restore: validation восстановления не прошла");
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(`backup-restore: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
