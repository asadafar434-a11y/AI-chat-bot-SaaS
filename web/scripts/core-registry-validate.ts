/**
 * Проверка локального JSON-снимка реестра для REGISTRY_PROVIDER=file.
 *
 * Запуск (web/):
 *   npm run core:registry:validate -- --file ./registry.json
 *   REGISTRY_FILE=./registry.json npm run core:registry:validate
 */
import { readRegistryFile } from "../src/server/core/registry/file.ts";

type StatusCounts = Record<string, number>;

const countStatuses = (records: Array<{ status: string }>): StatusCounts => {
  const result: StatusCounts = {};
  for (const record of records) result[record.status] = (result[record.status] ?? 0) + 1;
  return result;
};

async function main(): Promise<void> {
  const fileIndex = process.argv.indexOf("--file");
  const fromArg = fileIndex >= 0 ? process.argv[fileIndex + 1] : undefined;
  const filePath = (fromArg ?? process.env.REGISTRY_FILE ?? "").trim();
  if (!filePath) throw new Error("не задан --file или REGISTRY_FILE");

  const data = await readRegistryFile(filePath);
  const devices = data.devices ?? [];
  const medicines = data.medicines ?? [];

  console.log(
    JSON.stringify(
      {
        event: "core.registry.file.validated",
        devices: devices.length,
        medicines: medicines.length,
        deviceStatuses: countStatuses(devices),
        medicineStatuses: countStatuses(medicines),
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
        event: "core.registry.file.invalid",
        ok: false,
        error: error instanceof Error ? error.message : "неизвестная ошибка",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
