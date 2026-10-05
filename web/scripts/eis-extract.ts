/**
 * CLI извлечения документов: npm run eis:extract -- --tender=<registryNumber>
 *
 * Находит RAW-документы закупки (по manifest.json в data/raw), строит
 * normalized documents в data/normalized/documents/<registry>/ и печатает
 * статистику: documents / pages / tables / ocrRequired / failed.
 * Массовая обработка НЕ запускается: только явно указанная закупка.
 * RAW-файлы не изменяются.
 */
import { resolveOcrProvider } from "../src/server/eis/extract/ocr.ts";
import { extractTender } from "../src/server/eis/extract/pipeline.ts";

interface CliArgs {
  tender?: string;
  storage?: string;
  force: boolean;
  ocr?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { force: false, help: false };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      args.help = true;
      continue;
    }
    if (raw === "--force") {
      args.force = true;
      continue;
    }
    const m = raw.match(/^--([a-z-]+)=(.*)$/);
    if (!m) throw new Error(`Неизвестный аргумент: ${raw}. См. --help.`);
    const [, key, value] = m as [string, string, string];
    switch (key) {
      case "tender":
        args.tender = value;
        break;
      case "storage":
        args.storage = value;
        break;
      case "ocr":
        args.ocr = value;
        break;
      default:
        throw new Error(`Неизвестный аргумент: --${key}. См. --help.`);
    }
  }
  return args;
}

const HELP = `EIS Document Intelligence — извлечение структуры документов закупки.

Использование:
  npm run eis:extract -- --tender=0373100130926000001
  npm run eis:extract -- --tender=0373100130926000001 --force
  npm run eis:extract -- --tender=0373100130926000001 --storage=./data --ocr=anthropic

Аргументы:
  --tender=REGISTRY   реестровый номер закупки (обязателен; только одна закупка за запуск)
  --storage=PATH      корень dataset (default ./data или EIS_STORAGE_PATH)
  --force             переработать даже неизменённые файлы
  --ocr=none|anthropic OCR-провайдер (default none → сканы помечаются ocr_required)
  --help              эта справка

ENV: EIS_STORAGE_PATH, EIS_OCR_PROVIDER.
Сканы без провайдера: OCR_NOT_CONFIGURED (статус ocr_required), не выдумка текста.
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (!args.tender || !/^\d{11,19}$/.test(args.tender.trim())) {
    throw new Error("--tender обязателен: реестровый номер (11–19 цифр). Массовая обработка запрещена.");
  }
  const registryNumber = args.tender.trim();
  const storagePath = args.storage ?? process.env["EIS_STORAGE_PATH"] ?? "./data";
  const ocrProvider = await resolveOcrProvider(args.ocr);
  const stats = await extractTender(storagePath, registryNumber, { ocrProvider, force: args.force });
  console.log(`[eis-extract] tender: ${stats.tenderRegistryNumber}`);
  console.log(`[eis-extract] documents: ${stats.documents}`);
  console.log(`[eis-extract] pages: ${stats.pages}`);
  console.log(`[eis-extract] tables: ${stats.tables}`);
  console.log(`[eis-extract] ocrRequired: ${stats.ocrRequired}`);
  console.log(`[eis-extract] failed: ${stats.failed}`);
  console.log(`[eis-extract] skipped: ${stats.skipped}`);
  if (stats.failed > 0) process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(`[eis-extract] FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
