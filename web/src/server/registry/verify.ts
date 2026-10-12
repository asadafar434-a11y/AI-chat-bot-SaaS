import "server-only";
import { createDbRegistryStore, type RegistryDb } from "@/lib/registry-store-db";
import type { RegistryKind } from "@/lib/registry-types";
import { getPrismaClient } from "@/server/db/client";

// Перед сборкой файла заявки проверяем ещё раз: выбранный номер всё ещё есть среди действующих записей реестра.
// Участник мог выбрать его неделю назад, а свежая выгрузка уже могла эту запись снять. Тогда в файле — жёлтая пометка.

type Lookup = (kind: RegistryKind, numbers: string[]) => Promise<Set<string> | null>;

/** Номера, найденные среди действующих записей нужного реестра. null — проверить нельзя (нет базы или она недоступна): номер не трогаем. */
const databaseLookup: Lookup = async (kind, numbers) => {
  if (!process.env.DATABASE_URL) return null;
  try {
    const store = createDbRegistryStore(getPrismaClient() as unknown as RegistryDb);
    const found = await store.getByNumbers(kind, numbers);
    return new Set([...found.values()].filter((r) => r.status === "active").map((r) => r.registryNumber));
  } catch (error) {
    console.error("registry verify failed:", error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown");
    return null;
  }
};

type GoodWithNumber = { registryNumber?: string; registryKind?: RegistryKind; registryRejected?: boolean };

// Номер ищется в том реестре, из которого его выбрали: один и тот же номер в РПП и в РЭП — разные записи. Реестр не назван — РПП.
export async function rejectUnknownRegistryNumbers(goods: GoodWithNumber[], lookup: Lookup = databaseLookup): Promise<void> {
  const kinds = new Set(goods.filter((g) => g.registryNumber).map((g) => g.registryKind ?? "gisp_rpp_719"));
  for (const kind of kinds) {
    const mine = goods.filter((g) => g.registryNumber && (g.registryKind ?? "gisp_rpp_719") === kind);
    const known = await lookup(kind, [...new Set(mine.map((g) => g.registryNumber as string))]);
    if (!known) continue;
    for (const good of mine) {
      if (!known.has(good.registryNumber as string)) {
        delete good.registryNumber;
        good.registryRejected = true;
      }
    }
  }
}
