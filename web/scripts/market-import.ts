// Загрузка рыночных ценовых наблюдений в PostgreSQL: npm run market:import
//
//   npm run market:import -- --file="путь\к\выгрузке.csv" --source="ЕИС, реестр контрактов, выгрузка 22.10.2026" --kind=eis_contract --unit=т --vat=with --by="Имя" --dry-run   пробный прогон
//   npm run market:import -- --file="путь\к\выгрузке.csv" --source="..." --kind=eis_contract --unit=т --vat=with --by="Имя"                                              запись в базу
//   --file     таблица CSV, TSV или TXT (UTF-8 или windows-1251): наименование, цена за единицу, дата — обязательны; ещё НДС, количество, номер контракта — если есть;
//   --source   откуда цены: название источника и дата выгрузки; для строк без номера контракта источником становится «<это название>, строка N»;
//   --kind     eis_contract (реестр контрактов ЕИС), price_list (прайс-лист), tender_docs (документы закупки) или other;
//   --unit     единица измерения всех строк файла (т, кг, шт, м2…): в таблицах её обычно нет, а цены разных единиц сравнивать нельзя;
//   --vat      with — цены в файле с НДС, without — без НДС (приводятся к цене без НДС по ставке --vat-rate, по умолчанию 22);
//   --region   регион, если все цены из одного региона.
//
// Для записи нужна DATABASE_URL (локальная база: npm run db:up, затем npm run db:migrate:deploy). Это единственный путь загрузки цен: через сайт файлы не принимаются.
// Без даты и источника цена не принимается; повтор (та же цена, дата и источник) пропускается. Платных запросов здесь нет.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { decodeText } from "../src/lib/analog-import.ts";
import type { Vat } from "../src/lib/indicative-price.ts";
import { SOURCE_KIND_LABELS, observationsFromTable, type SourceKind } from "../src/lib/market-observations.ts";
import { createDbMarketStore, type MarketDb } from "../src/lib/market-store-db.ts";
import { disconnectPrisma, getPrismaClient } from "../src/server/db/client.ts";

const args = new Map(process.argv.slice(2).map((a) => {
  const [key, ...rest] = a.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));

const fail = (message: string): never => {
  throw new Error(message);
};
const need = (name: string, hint: string): string => {
  const v = args.get(name);
  return v && v !== "true" ? v : fail(`укажите --${name}: ${hint}`);
};

async function main() {
  const file = need("file", 'путь к таблице, например --file="C:\\prices\\eis.csv"');
  const source = need("source", 'откуда цены, например --source="ЕИС, реестр контрактов, выгрузка 22.10.2026"');
  const kind = need("kind", Object.keys(SOURCE_KIND_LABELS).join(" | ")) as SourceKind;
  if (!(kind in SOURCE_KIND_LABELS)) fail(`--kind: одно из ${Object.keys(SOURCE_KIND_LABELS).join(", ")}`);
  const unit = need("unit", "единица измерения всех строк файла, например --unit=т");
  const vatArg = need("vat", "with — цены с НДС, without — без НДС");
  const vat: Vat = vatArg === "with" ? "with" : vatArg === "without" ? "without" : fail("--vat: with или without");
  const vatRate = args.has("vat-rate") ? Number(args.get("vat-rate")) : 22;
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 30) fail("--vat-rate: ставка НДС в процентах, например 22");
  const dryRun = args.has("dry-run");
  const by = args.get("by");
  if (!dryRun && (!by || by === "true")) fail('для записи укажите, кто загружает: --by="Имя"');
  if (!dryRun && !process.env.DATABASE_URL) fail("для записи нужна DATABASE_URL (локальная база: npm run db:up, затем npm run db:migrate:deploy)");

  const bytes = readFileSync(file);
  const text = decodeText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const { observations, skipped } = observationsFromTable(text, { source, sourceKind: kind, unit, region: args.get("region") ?? null, defaultVat: vat, vatRate });
  console.log(`Файл: ${basename(file)}${dryRun ? "  (пробный прогон: в базу ничего не пишется)" : ""}`);
  console.log(`Источник: ${source} (${SOURCE_KIND_LABELS[kind]}); единица: ${unit}; цены в файле ${vat === "with" ? `с НДС ${vatRate} %` : "без НДС"}`);
  console.log(`Принято наблюдений: ${observations.length}; пропущено строк: ${skipped.length}`);
  for (const s of skipped.slice(0, 10)) console.log(`  строка ${s.line}: ${s.reason}`);
  if (skipped.length > 10) console.log(`  … и ещё ${skipped.length - 10}`);
  if (observations.length === 0) fail("нечего загружать: ни одной строки с названием, ценой и датой");
  if (dryRun) return;

  const store = createDbMarketStore(getPrismaClient() as unknown as MarketDb);
  const result = await store.ingest(observations, by ?? null);
  console.log(`Записано в базу: ${result.added}; уже было (повторы): ${result.skipped}; всего в базе: ${await store.count()}`);
}

main()
  .catch((error) => {
    console.error(`Ошибка: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
