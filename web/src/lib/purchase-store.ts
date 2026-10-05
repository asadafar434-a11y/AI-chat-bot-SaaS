import { notifyDataChanged } from "@/lib/data-events";
import { fromStore, toStore } from "@/lib/data-format";
import { STORES, transaction } from "@/lib/db";
import { stampsOf } from "@/lib/doc-changes";
import type { Purchase } from "@/lib/purchase";
import type { FailedFile, SentDocument } from "@/lib/read-documents";
import {
  fetchDocumentMetas,
  fetchPurchase,
  fetchPurchases,
  serverReadsEnabled,
  type ServerDocumentMeta,
} from "@/lib/server-reads";
import { deleteServerWrite, postServerWrite, serverWritesEnabled } from "@/lib/server-writes";

// Закупки и их документы. До S11 Final Read Cutover читались из IndexedDB; теперь
// источник чтения — сервер (PostgreSQL + S6), а IndexedDB остаётся только для S5
// dual-write и совместимости. `NEXT_PUBLIC_SERVER_READS=0` возвращает legacy-чтение
// (тесты/dev); серверного фолбэка на IndexedDB нет.
const PURCHASES = STORES.purchases;
const DOCUMENTS = STORES.documents;

export const listPurchases = async (): Promise<Purchase[]> => {
  if (serverReadsEnabled()) {
    return fetchPurchases();
  }
  return (await transaction<unknown[]>([PURCHASES], "readonly", (tx) => tx.objectStore(PURCHASES).getAll())).map((raw) =>
    fromStore<Purchase>("purchase", raw)
  );
};

export async function getPurchase(id: string): Promise<Purchase | undefined> {
  if (serverReadsEnabled()) {
    return (await fetchPurchase(id)) ?? undefined;
  }
  const raw = await transaction<unknown>([PURCHASES], "readonly", (tx) => tx.objectStore(PURCHASES).get(id));
  return raw === undefined ? undefined : fromStore<Purchase>("purchase", raw);
}

/** Документ сервера → форма отправки (`SentDocument`). Текст отсутствует (`missing`) — `null`, а не «пустой текст». */
function toSentDocument(meta: ServerDocumentMeta): SentDocument | null {
  if (meta.text === null) {
    return null;
  }
  return { name: meta.name, text: meta.text, ...(meta.scan && { scan: true }), ...(meta.map && { map: meta.map }) };
}

/** Документы и причина, по которой часть из них нечитаема (нет текста в S6). */
export type LoadedDocuments = { documents: SentDocument[]; unreadable: FailedFile[] };

const getLocalDocuments = async (id: string): Promise<SentDocument[]> =>
  ((await transaction<unknown[] | undefined>([DOCUMENTS], "readonly", (tx) => tx.objectStore(DOCUMENTS).get(id))) ?? []).map(
    (raw) => fromStore<SentDocument>("document", raw)
  );

/**
 * Документы закупки для UI. Серверный путь сохраняет семантику `textStatus`: документ
 * без текста не превращается в «пустой документ», а попадает в `unreadable` с причиной.
 */
export async function loadDocuments(id: string): Promise<LoadedDocuments> {
  if (!serverReadsEnabled()) {
    return { documents: await getLocalDocuments(id), unreadable: [] };
  }
  const metas = await fetchDocumentMetas(id);
  const documents: SentDocument[] = [];
  const unreadable: FailedFile[] = [];
  for (const meta of metas) {
    const doc = toSentDocument(meta);
    if (doc) {
      documents.push(doc);
    } else {
      unreadable.push({ name: meta.name, reason: meta.readError ?? "текст документа не найден" });
    }
  }
  return { documents, unreadable };
}

/** Только читаемые документы (`SentDocument[]`); нечитаемые отдаёт `loadDocuments`. */
export const getDocuments = async (id: string): Promise<SentDocument[]> => (await loadDocuments(id)).documents;

export const savePurchase = async (purchase: Purchase): Promise<void> => {
  await transaction<void>([PURCHASES], "readwrite", (tx) => {
    tx.objectStore(PURCHASES).put(toStore("purchase", purchase));
  });
  // Dual-write S5: сначала legacy, затем сервер. Ошибка сервера бросается наружу —
  // legacy уже записан, расхождение увидит reconciliation.
  if (serverWritesEnabled()) {
    await postServerWrite(`/api/writes/purchases/${encodeURIComponent(purchase.id)}`, "PUT", { purchase });
  }
  notifyDataChanged();
};

export const scansOf = (documents: SentDocument[]) => documents.filter((d) => d.scan).map((d) => d.name);

// Возвращает закупку в том виде, в каком она сохранена: со списком файлов со скана и снимком документов (по нему видно,
// что изменилось с тех пор, как составили ТП).
export async function savePurchaseWithDocuments(purchase: Purchase, documents: SentDocument[]): Promise<Purchase> {
  const stored = { ...purchase, scans: scansOf(documents), docs: stampsOf(documents) };
  await transaction<void>([PURCHASES, DOCUMENTS], "readwrite", (tx) => {
    tx.objectStore(PURCHASES).put(toStore("purchase", stored));
    tx.objectStore(DOCUMENTS).put(documents.map((doc) => toStore("document", doc)), purchase.id);
  });
  if (serverWritesEnabled()) {
    await postServerWrite(`/api/writes/purchases/${encodeURIComponent(purchase.id)}/documents`, "PUT", {
      purchase: stored,
      documents,
    });
  }
  notifyDataChanged();
  return stored;
}

// Закупки, сохранённые до появления списка сканов, узнают о них по самим документам.
export async function scanNames(purchase: Purchase): Promise<string[]> {
  return purchase.scans ?? scansOf(await getDocuments(purchase.id));
}

export const deletePurchase = async (id: string): Promise<void> => {
  await transaction<void>([PURCHASES, DOCUMENTS], "readwrite", (tx) => {
    tx.objectStore(PURCHASES).delete(id);
    tx.objectStore(DOCUMENTS).delete(id);
  });
  if (serverWritesEnabled()) {
    await deleteServerWrite(`/api/writes/purchases/${encodeURIComponent(id)}`);
  }
  notifyDataChanged();
};
