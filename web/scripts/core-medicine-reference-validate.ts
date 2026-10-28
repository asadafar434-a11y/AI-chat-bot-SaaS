/**
 * Проверка локального JSON-снимка ЖНВЛП/НДС для MEDICINE_REFERENCE_PROVIDER=file.
 *
 * Запуск (web/):
 *   npm run core:medicine-reference:validate -- --file ./reference.json
 *   MEDICINE_REFERENCE_FILE=./reference.json npm run core:medicine-reference:validate
 */
import { readMedicineReferenceFile } from "../src/server/core/reference/file.ts";

async function main(): Promise<void> {
  const fileIndex = process.argv.indexOf("--file");
  const fromArg = fileIndex >= 0 ? process.argv[fileIndex + 1] : undefined;
  const filePath = (fromArg ?? process.env.MEDICINE_REFERENCE_FILE ?? "").trim();
  if (!filePath) throw new Error("не задан --file или MEDICINE_REFERENCE_FILE");

  const data = await readMedicineReferenceFile(filePath);
  const items = data.items ?? [];

  console.log(
    JSON.stringify(
      {
        event: "core.medicine-reference.file.validated",
        items: items.length,
        zhvnlp: items.filter((item) => item.zhvnlp).length,
        withMaxPrice: items.filter((item) => item.maxPrice !== undefined).length,
        withVatRate: items.filter((item) => item.vatRate !== undefined).length,
        snapshot: data.snapshot,
        ok: true,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.log(
    JSON.stringify(
      {
        event: "core.medicine-reference.file.invalid",
        ok: false,
        error: error instanceof Error ? error.message : "неизвестная ошибка",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
