import { STORES, transaction } from "@/lib/db";
import type { Purchase } from "@/lib/purchase";
import type { SentDocument } from "@/lib/read-documents";

// Закупки живут в IndexedDB этого браузера: документы не уходят никуда, кроме запросов к модели.
// Тексты документов лежат отдельно, чтобы список закупок не тянул их целиком.
const PURCHASES = STORES.purchases;
const DOCUMENTS = STORES.documents;

export const listPurchases = () =>
  transaction<Purchase[]>([PURCHASES], "readonly", (tx) => tx.objectStore(PURCHASES).getAll());

export const getPurchase = (id: string) =>
  transaction<Purchase | undefined>([PURCHASES], "readonly", (tx) => tx.objectStore(PURCHASES).get(id));

export const getDocuments = async (id: string) =>
  (await transaction<SentDocument[] | undefined>([DOCUMENTS], "readonly", (tx) => tx.objectStore(DOCUMENTS).get(id))) ?? [];

export const savePurchase = (purchase: Purchase) =>
  transaction<void>([PURCHASES], "readwrite", (tx) => {
    tx.objectStore(PURCHASES).put(purchase);
  });

export const scansOf = (documents: SentDocument[]) => documents.filter((d) => d.scan).map((d) => d.name);

// Возвращает закупку в том виде, в каком она сохранена: со списком файлов со скана.
export async function savePurchaseWithDocuments(purchase: Purchase, documents: SentDocument[]): Promise<Purchase> {
  const stored = { ...purchase, scans: scansOf(documents) };
  await transaction<void>([PURCHASES, DOCUMENTS], "readwrite", (tx) => {
    tx.objectStore(PURCHASES).put(stored);
    tx.objectStore(DOCUMENTS).put(documents, purchase.id);
  });
  return stored;
}

// Закупки, сохранённые до появления списка сканов, узнают о них по самим документам.
export async function scanNames(purchase: Purchase): Promise<string[]> {
  return purchase.scans ?? scansOf(await getDocuments(purchase.id));
}

export const deletePurchase = (id: string) =>
  transaction<void>([PURCHASES, DOCUMENTS], "readwrite", (tx) => {
    tx.objectStore(PURCHASES).delete(id);
    tx.objectStore(DOCUMENTS).delete(id);
  });
