import { fromStore, toStore } from "@/lib/data-format";
import { STORES, transaction } from "@/lib/db";
import { stampsOf } from "@/lib/doc-changes";
import type { Purchase } from "@/lib/purchase";
import type { SentDocument } from "@/lib/read-documents";

// Закупки живут в IndexedDB этого браузера: документы не уходят никуда, кроме запросов к модели.
// Тексты документов лежат отдельно, чтобы список закупок не тянул их целиком.
// Записи читаются и пишутся через data-format.ts: старые догоняют текущий формат при чтении.
const PURCHASES = STORES.purchases;
const DOCUMENTS = STORES.documents;

export const listPurchases = async () =>
  (await transaction<unknown[]>([PURCHASES], "readonly", (tx) => tx.objectStore(PURCHASES).getAll())).map((raw) =>
    fromStore<Purchase>("purchase", raw)
  );

export async function getPurchase(id: string): Promise<Purchase | undefined> {
  const raw = await transaction<unknown>([PURCHASES], "readonly", (tx) => tx.objectStore(PURCHASES).get(id));
  return raw === undefined ? undefined : fromStore<Purchase>("purchase", raw);
}

export const getDocuments = async (id: string) =>
  ((await transaction<unknown[] | undefined>([DOCUMENTS], "readonly", (tx) => tx.objectStore(DOCUMENTS).get(id))) ?? []).map(
    (raw) => fromStore<SentDocument>("document", raw)
  );

export const savePurchase = (purchase: Purchase) =>
  transaction<void>([PURCHASES], "readwrite", (tx) => {
    tx.objectStore(PURCHASES).put(toStore("purchase", purchase));
  });

export const scansOf = (documents: SentDocument[]) => documents.filter((d) => d.scan).map((d) => d.name);

// Возвращает закупку в том виде, в каком она сохранена: со списком файлов со скана и снимком документов (по нему видно,
// что изменилось с тех пор, как составили ТП).
export async function savePurchaseWithDocuments(purchase: Purchase, documents: SentDocument[]): Promise<Purchase> {
  const stored = { ...purchase, scans: scansOf(documents), docs: stampsOf(documents) };
  await transaction<void>([PURCHASES, DOCUMENTS], "readwrite", (tx) => {
    tx.objectStore(PURCHASES).put(toStore("purchase", stored));
    tx.objectStore(DOCUMENTS).put(documents.map((doc) => toStore("document", doc)), purchase.id);
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
