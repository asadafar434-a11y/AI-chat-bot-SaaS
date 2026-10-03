/**
 * CLI коллектора ЕИС: npm run eis:collect -- --law=44fz --date-from=2026-09-01 ...
 *
 * Запуск: node --experimental-strip-types scripts/eis-collect.ts [args]
 * По умолчанию DRY-RUN (файлы не скачиваются). Реальный запуск: --live.
 *
 * Никогда не печатает секреты: конфигурация логируется через redactedConfig().
 */
import { loadEisConfig, parseDateParam, parseLaw, redactedConfig } from "../src/server/eis/config.ts";
import { EisError, errorText } from "../src/server/eis/errors.ts";
import { runCollector } from "../src/server/eis/collector.ts";
import type { EisDiscoveryFilters } from "../src/server/eis/types.ts";

interface CliArgs {
  law?: string;
  dateFrom?: string;
  dateTo?: string;
  region?: string;
  docType?: string;
  maxTenders?: number;
  dryRun?: boolean;
  storage?: string;
  baseUrl?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      args.help = true;
      continue;
    }
    if (raw === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (raw === "--live") {
      args.dryRun = false;
      continue;
    }
    const m = raw.match(/^--([a-z-]+)=(.*)$/);
    if (!m) throw new EisError("CONFIG_ERROR", `Неизвестный аргумент: ${raw}. См. --help.`);
    const [, key, value] = m as [string, string, string];
    switch (key) {
      case "law":
        args.law = value;
        break;
      case "date-from":
        args.dateFrom = value;
        break;
      case "date-to":
        args.dateTo = value;
        break;
      case "region":
        args.region = value;
        break;
      case "doc-type":
        args.docType = value;
        break;
      case "max-tenders": {
        const n = Number.parseInt(value, 10);
        if (!Number.isInteger(n) || n < 1) throw new EisError("CONFIG_ERROR", `--max-tenders должен быть целым >= 1`);
        args.maxTenders = n;
        break;
      }
      case "storage":
        args.storage = value;
        break;
      case "base-url":
        args.baseUrl = value;
        break;
      default:
        throw new EisError("CONFIG_ERROR", `Неизвестный аргумент: --${key}. См. --help.`);
    }
  }
  return args;
}

const HELP = `EIS Collector v1 — сбор RAW/SILVER dataset закупок ЕИС.

Использование:
  npm run eis:collect -- --law=44fz --date-from=2026-09-01 --date-to=2026-09-02 --max-tenders=10 --dry-run
  npm run eis:collect -- --law=44fz --date-from=2026-09-01 --date-to=2026-09-01 --max-tenders=10 --live

Аргументы:
  --law=44fz|223fz        контур (223fz в v1: NOT_IMPLEMENTED, см. README)
  --date-from=YYYY-MM-DD  начало периода (включительно)
  --date-to=YYYY-MM-DD    конец периода (включительно)
  --region=CODE           код региона заказчика (например 77)
  --doc-type=TYPE         тип документа СОИ (по официальной XSD, напр. epNotificationEF2020)
  --max-tenders=N         лимит закупок (default 100, hard cap 1000)
  --dry-run               только план: без скачивания файлов (default)
  --live                  реальный запуск со скачиванием
  --storage=PATH          корень dataset (default ./data)
  --base-url=URL          переопределение endpoint СОИ
  --help                  эта справка

ENV (см. .env.example, секция EIS):
  EIS_AUTH_TOKEN (обязателен для live/discovery; dry-run с mock не требует),
  EIS_DRY_RUN, EIS_MAX_TENDERS, EIS_REQUEST_DELAY_MS, EIS_MAX_RETRIES,
  EIS_TIMEOUT_MS, EIS_STORAGE_PATH, EIS_BASE_URL.

Токен: https://zakupki.gov.ru/pmd/auth/welcome (инструкция СОИ ЕИС).
223-ФЗ и массовые выгрузки 10k/50k — вне scope v1.
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  const law = parseLaw(args.law);
  const dateFrom = parseDateParam("date-from", args.dateFrom);
  const dateTo = parseDateParam("date-to", args.dateTo);
  if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) {
    // Разрешаем одиночную дату: второй край = первый.
  }
  const single = dateFrom ?? dateTo;
  const filters: EisDiscoveryFilters = {
    law,
    region: args.region || process.env["EIS_REGION"] || undefined,
    dateFrom: dateFrom ?? single,
    dateTo: dateTo ?? single,
    procurementType: args.docType || process.env["EIS_DOC_TYPE"] || undefined,
  };
  const config = loadEisConfig({
    baseUrl: args.baseUrl,
    dryRun: args.dryRun,
    maxTenders: args.maxTenders,
    storagePath: args.storage,
  });

  console.log(`[eis] config: ${JSON.stringify(redactedConfig(config))}`);
  console.log(
    `[eis] filters: ${JSON.stringify({ law: filters.law, region: filters.region ?? "-", dateFrom: filters.dateFrom ?? "-", dateTo: filters.dateTo ?? "-", procurementType: filters.procurementType ?? "-" })}`,
  );

  const stats = await runCollector({ config, filters, dryRun: args.dryRun, maxTenders: args.maxTenders });

  if (stats.dryRun) {
    console.log(`[eis] DRY-RUN: скачивание файлов отключено.`);
    console.log(`[eis] Найдено закупок: ${stats.found}. К обработке: ${stats.toProcess}.`);
    console.log(`[eis] Registry numbers: ${stats.processedRegistryNumbers.join(", ") || "(нет)"}`);
    console.log(`[eis] Ожидается документов (по метаданным): ${stats.documentsExpected}.`);
  } else {
    console.log(
      `[eis] Готово: успешно ${stats.succeeded}/${stats.toProcess}, ошибок ${stats.failed}, ` +
        `файлов скачано ${stats.documentsDownloaded}, переиспользовано ${stats.documentsReused}.`,
    );
    if (stats.failed > 0) {
      console.log(`[eis] Ошибки по закупкам: ${JSON.stringify(stats.failures)}`);
      process.exitCode = 2;
    }
  }
}

main().catch((err: unknown) => {
  console.error(`[eis] FATAL: ${errorText(err)}`);
  process.exitCode = 1;
});
