// Перенос копии tender-lawyer-backup v1 в PostgreSQL (этап S3).
//
// Запуск из каталога web/:
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     --import ./scripts/test-alias.mjs scripts/legacy-import.mjs \
//     --file <копия.json> --org <organizationId> --user <userId> [--batch-key <ключ>] [--dry-run] [--json]
//
// --dry-run не выполняет ни одной записи: показывает план и текущее состояние цели.
// Коды выхода: 0 — match / already-imported / dry-run; 2 — mismatch; 1 — ошибка.
// Копия обязана храниться вне репозитория (персональные данные); скрипт её только читает.
// IndexedDB скрипт не трогает: вход — строка файла копии.
import { readFile } from "node:fs/promises";

import { getDb, getTransactionRunner } from "../src/server/db/client.ts";
import { orgScope } from "../src/server/db/org-scope.ts";
import { runLegacyImport } from "../src/server/import/pipeline.ts";
import { optionalStorageAdapter } from "../src/server/storage/config.ts";
import { ImportError } from "../src/server/import/types.ts";

function usage() {
  console.error(
    "usage: legacy-import.mjs --file <копия.json> --org <organizationId> --user <userId> [--batch-key <ключ>] [--dry-run] [--json]",
  );
}

const argv = process.argv.slice(2);
const get = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const file = get("file");
const org = get("org");
const user = get("user");
const batchKey = get("batch-key") ?? undefined;
const dryRun = argv.includes("--dry-run");
const asJson = argv.includes("--json");

if (!file || !org || !user || argv.some((a) => a.startsWith("--") && !["--file", "--org", "--user", "--batch-key", "--dry-run", "--json"].includes(a))) {
  usage();
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("legacy-import: не задан DATABASE_URL");
  process.exit(1);
}

try {
  const raw = await readFile(file, "utf8");
  // S11-R0: с настроенным S6 переносится и содержимое (текст/карта), иначе —
  // только метаданные. dry-run ничего не пишет.
  const run = await runLegacyImport({
    db: getDb(),
    run: getTransactionRunner(),
    scope: orgScope(org),
    userId: user,
    raw,
    batchKey,
    dryRun,
    storage: dryRun ? undefined : optionalStorageAdapter(),
  });
  console.log(run.reconciliation.summary);
  if (asJson) {
    console.log(JSON.stringify(run.reconciliation, null, 2));
  }
  const verdict = run.reconciliation.verdict;
  process.exit(verdict === "match" || verdict === "already-imported" || verdict === "dry-run" ? 0 : 2);
} catch (error) {
  if (error instanceof ImportError) {
    console.error(`legacy-import: ${error.message}`);
  } else {
    console.error(`legacy-import: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
  process.exit(1);
}
