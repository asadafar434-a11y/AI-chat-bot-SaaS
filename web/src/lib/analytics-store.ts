import { STORES, transaction } from "@/lib/db";
import { normalizeRegister, type RegisterData } from "@/lib/hidden-costs";
import { normalizeRic, type RicData } from "@/lib/indicative-price";

// Расчёты раздела «Аналитика» по закупкам: сейчас — РИЦ (расчёт индикативной цены, lib/indicative-price.ts): позиции, введённые цены-аналоги с источниками и датами, настройки.
// Лежат в браузере отдельной базой; «Удалить все данные» стирает её вместе с остальными, а удаление закупки — её расчёт.
const RIC = STORES.ric;

type StoredRic = RicData & { id: string; savedAt: string };
type StoredRegister = RegisterData & { id: string; savedAt: string };

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

// Реестр скрытых затрат и таблица чувствительности по закупке лежат в том же хранилище под ключом «<закупка>#risks»: новое хранилище потребовало бы новой базы.
const registerKey = (purchaseId: string) => `${purchaseId}#risks`;

export async function getRegister(purchaseId: string): Promise<RegisterData | undefined> {
  const record = await transaction<StoredRegister | undefined>([RIC], "readonly", (tx) => tx.objectStore(RIC).get(registerKey(purchaseId)));
  return record ? normalizeRegister(record) : undefined;
}

export async function saveRegister(purchaseId: string, data: RegisterData): Promise<void> {
  const record: StoredRegister = { ...data, id: registerKey(purchaseId), savedAt: new Date().toISOString() };
  await transaction<void>([RIC], "readwrite", (tx) => {
    tx.objectStore(RIC).put(record);
  });
}

export async function deleteRicOf(purchaseId: string): Promise<void> {
  await transaction<void>([RIC], "readwrite", (tx) => {
    tx.objectStore(RIC).delete(purchaseId);
    tx.objectStore(RIC).delete(registerKey(purchaseId));
  });
}
