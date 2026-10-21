import { STORES, transaction } from "@/lib/db";
import { normalizeRic, type RicData } from "@/lib/indicative-price";

// Расчёты раздела «Аналитика» по закупкам: сейчас — РИЦ (расчёт индикативной цены, lib/indicative-price.ts): позиции, введённые цены-аналоги с источниками и датами, настройки.
// Лежат в браузере отдельной базой; «Удалить все данные» стирает её вместе с остальными, а удаление закупки — её расчёт.
const RIC = STORES.ric;

type StoredRic = RicData & { id: string; savedAt: string };

export async function getRic(purchaseId: string): Promise<RicData | undefined> {
  const record = await transaction<StoredRic | undefined>([RIC], "readonly", (tx) => tx.objectStore(RIC).get(purchaseId));
  return record ? normalizeRic(record) : undefined;
}

export async function saveRic(purchaseId: string, data: RicData): Promise<void> {
  const record: StoredRic = { ...data, id: purchaseId, savedAt: new Date().toISOString() };
  await transaction<void>([RIC], "readwrite", (tx) => {
    tx.objectStore(RIC).put(record);
  });
}

export async function deleteRicOf(purchaseId: string): Promise<void> {
  await transaction<void>([RIC], "readwrite", (tx) => {
    tx.objectStore(RIC).delete(purchaseId);
  });
}
