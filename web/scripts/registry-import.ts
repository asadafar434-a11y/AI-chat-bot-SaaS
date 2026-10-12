// Импорт выгрузки реестра промышленной продукции (ГИСП) в PostgreSQL: npm run registry:import
//
//   npm run registry:import -- --file="путь\к\production_res_valid_only.xlsx" --by="Имя" --dry-run   пробный прогон, в базу ничего не пишется
//   npm run registry:import -- --file="путь\к\выгрузке.xlsx" --by="Имя"                              запись в базу
//   ... --allow-shrink    разрешить пометить пропавшие записи, даже если выгрузка выглядит неполной
//
// Для записи нужна DATABASE_URL (локальная база: npm run db:up, затем npm run db:migrate:deploy).
// Это единственный путь загрузки реестра: через сайт файлы не принимаются. Права на импорт — доступ к серверу и базе.
// Платных запросов здесь нет.

import { basename } from "node:path";
import { importRegistry } from "../src/lib/registry-import.ts";
import { createMemoryRegistryStore } from "../src/lib/registry-store.ts";
import { createDbRegistryStore, type RegistryDb } from "../src/lib/registry-store-db.ts";
import { REGISTRY_TITLES, RegistryError, type RegistryImportReport } from "../src/lib/registry-types.ts";
import { disconnectPrisma, getPrismaClient } from "../src/server/db/client.ts";
import { openXlsx } from "../src/server/registry/xlsx-stream.ts";

const args = new Map(process.argv.slice(2).map((a) => {
  const [key, ...rest] = a.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));

function printReport(report: RegistryImportReport, exportedAt: string | null) {
  console.log(`Время выгрузки (по файлу): ${exportedAt ?? "не указано"}`);
  console.log(`Прочитано строк: ${report.rowsRead}; пропущено: ${report.rowsSkipped}; с ошибкой: ${report.rowsFailed}`);
  console.log(`Записей реестра: добавлено ${report.recordsAdded}, изменено ${report.recordsChanged}, без изменений ${report.recordsUnchanged}, вернулось ${report.recordsReturned}, пропало (absent) ${report.recordsAbsent}`);
  console.log(`Номеров с несколькими основаниями: ${report.multiRowRecords}; из них с разными сроками действия: ${report.differingValidity}`);
  const warnings = Object.entries(report.warnings);
  if (warnings.length) console.log("Предупреждения:", warnings.map(([k, n]) => `${k}: ${n}`).join("; "));
  if (report.unknownColumns.length) console.log("Колонки, которых формат не знает (не загружены):", report.unknownColumns.join(", "));
  if (report.absentSkippedReason) console.log("ВНИМАНИЕ:", report.absentSkippedReason);
  if (report.samples.length) {
    console.log("Примеры пропусков и ошибок:");
    for (const s of report.samples.slice(0, 10)) console.log(`  строка ${s.row}: ${s.reason}`);
  }
}

async function main() {
  const file = args.get("file");
  if (!file || file === "true") throw new Error('укажите файл: --file="путь\\к\\выгрузке.xlsx"');
  const dryRun = args.has("dry-run");
  const by = args.get("by");
  if (!dryRun && (!by || by === "true")) throw new Error('для записи укажите, кто загружает: --by="Имя"');
  if (!dryRun && !process.env.DATABASE_URL) throw new Error("для записи нужна DATABASE_URL (локальная база: npm run db:up, затем npm run db:migrate:deploy)");

  const kind = "gisp_rpp_719" as const;
  console.log(`Реестр: ${REGISTRY_TITLES[kind]}`);
  console.log(`Файл: ${basename(file)}${dryRun ? "  (пробный прогон: в базу ничего не пишется)" : ""}`);
  const started = Date.now();
  const opened = await openXlsx(file);
  console.log(`Размер: ${(opened.size / 1048576).toFixed(1)} МБ; SHA-256: ${opened.sha256.slice(0, 16)}…; лист: «${opened.sheetName}»`);

  const store = dryRun ? createMemoryRegistryStore() : createDbRegistryStore(getPrismaClient() as unknown as RegistryDb);
  const { report, dataset } = await importRegistry(store, {
    registryKind: kind,
    fileName: basename(file),
    fileSha256: opened.sha256,
    rows: opened.rows,
    declaredRows: opened.declaredRows,
    importedBy: by && by !== "true" ? by : null,
    allowShrink: args.has("allow-shrink"),
  });
  if (report.alreadyImported) console.log("Этот файл уже был загружен ранее: ничего не изменено.");
  printReport(report, dataset.exportedAt);
  console.log(`\nГотово за ${((Date.now() - started) / 1000).toFixed(1)} с.${dryRun ? " Это был пробный прогон." : ""}`);
}

main()
  .catch((error) => {
    console.error(error instanceof RegistryError ? `Ошибка загрузки: ${error.message}` : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
