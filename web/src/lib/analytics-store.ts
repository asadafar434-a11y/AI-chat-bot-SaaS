import { STORES, transaction } from "@/lib/db";
import { normalizeRegister, type RegisterData } from "@/lib/hidden-costs";
import { normalizeRic, type RicData } from "@/lib/indicative-price";
import { normalizePrices, type SavedPrices } from "@/lib/price-cache";
import { normalizeRates, type SavedRates } from "@/lib/rate-cache";

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

// Закупочные цены, найденные в интернете при разборе закупки (lib/price-cache.ts): с датой, годны неделю, живут у самой закупки в том же хранилище.
type StoredPrices = SavedPrices & { id: string; savedAt: string };
const pricesKey = (purchaseId: string) => `${purchaseId}#prices`;

export async function getPrices(purchaseId: string): Promise<SavedPrices | undefined> {
  const record = await transaction<StoredPrices | undefined>([RIC], "readonly", (tx) => tx.objectStore(RIC).get(pricesKey(purchaseId)));
  return record ? normalizePrices(record) : undefined;
}

export async function savePrices(purchaseId: string, data: SavedPrices): Promise<void> {
  const record: StoredPrices = { ...data, id: pricesKey(purchaseId), savedAt: new Date().toISOString() };
  await transaction<void>([RIC], "readwrite", (tx) => {
    tx.objectStore(RIC).put(record);
  });
}

// Зарплаты и аренда техники, найденные в интернете по составу исполнения (lib/rate-cache.ts): с датой, годны две недели, живут у закупки там же.
type StoredRates = SavedRates & { id: string; savedAt: string };
const ratesKey = (purchaseId: string) => `${purchaseId}#rates`;

export async function getRates(purchaseId: string): Promise<SavedRates | undefined> {
  const record = await transaction<StoredRates | undefined>([RIC], "readonly", (tx) => tx.objectStore(RIC).get(ratesKey(purchaseId)));
  return record ? normalizeRates(record) : undefined;
}

export async function saveRates(purchaseId: string, data: SavedRates): Promise<void> {
  const record: StoredRates = { ...data, id: ratesKey(purchaseId), savedAt: new Date().toISOString() };
  await transaction<void>([RIC], "readwrite", (tx) => {
    tx.objectStore(RIC).put(record);
  });
}

export async function deleteRicOf(purchaseId: string): Promise<void> {
  await transaction<void>([RIC], "readwrite", (tx) => {
    tx.objectStore(RIC).delete(purchaseId);
    tx.objectStore(RIC).delete(registerKey(purchaseId));
    tx.objectStore(RIC).delete(pricesKey(purchaseId));
    tx.objectStore(RIC).delete(ratesKey(purchaseId));
  });
}
