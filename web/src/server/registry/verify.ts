import "server-only";
import { createDbRegistryStore, type RegistryDb } from "@/lib/registry-store-db";
import { getPrismaClient } from "@/server/db/client";

// Перед сборкой файла заявки проверяем ещё раз: выбранный номер всё ещё есть среди действующих записей реестра.
// Участник мог выбрать его неделю назад, а свежая выгрузка уже могла эту запись снять. Тогда в файле — жёлтая пометка.

type Lookup = (numbers: string[]) => Promise<Set<string> | null>;

/** Номера, найденные среди действующих записей. null — проверить нельзя (нет базы или она недоступна): номер не трогаем. */
const databaseLookup: Lookup = async (numbers) => {
  if (!process.env.DATABASE_URL) return null;
  try {
    const store = createDbRegistryStore(getPrismaClient() as unknown as RegistryDb);
    const found = await store.getByNumbers("gisp_rpp_719", numbers);
    return new Set([...found.values()].filter((r) => r.status === "active").map((r) => r.registryNumber));
  } catch (error) {
    console.error("registry verify failed:", error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown");
    return null;
  }
};

type GoodWithNumber = { registryNumber?: string; registryRejected?: boolean };

export async function rejectUnknownRegistryNumbers(goods: GoodWithNumber[], lookup: Lookup = databaseLookup): Promise<void> {
  const numbers = [...new Set(goods.flatMap((g) => (g.registryNumber ? [g.registryNumber] : [])))];
  if (numbers.length === 0) return;
  const known = await lookup(numbers);
  if (!known) return;
  for (const good of goods) {
    if (good.registryNumber && !known.has(good.registryNumber)) {
      delete good.registryNumber;
      good.registryRejected = true;
    }
  }
}
