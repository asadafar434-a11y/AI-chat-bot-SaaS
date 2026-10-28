import { STORES, transaction } from "@/lib/db";
import { EMPTY_FILTERS, type TenderFilters, type TenderListing, type TenderSort } from "@/lib/tender-search";

// «Поиск закупок»: выгрузка закупок из ЕИС и последние фильтры лежат в браузере, в хранилище расчётов (как цены и зарплаты): «Удалить все данные» стирает их вместе с остальными.
// Выгрузка — не закупка участника: в «Мои закупки» она не попадает, пока участник сам не загрузит документы.

const KEY = "tender-search#list";

export type SavedTenders = { listings: TenderListing[]; loadedAt: string; filters: TenderFilters; sort: TenderSort };
type Stored = SavedTenders & { id: string; savedAt: string };

const SORTS: TenderSort[] = ["deadline", "newest", "priceDesc", "priceAsc"];
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Из хранилища приводим к форме: испорченное поле заменяется пустым, а не ломает экран. */
export function normalizeTenders(raw: Partial<SavedTenders> | null | undefined): SavedTenders {
  const f = (raw?.filters ?? {}) as Partial<TenderFilters>;
  const listings = Array.isArray(raw?.listings)
    ? raw.listings.flatMap((l): TenderListing[] => {
        const id = str(l?.id);
        if (!id) return [];
        return [{ id, law: l.law === "44-ФЗ" || l.law === "223-ФЗ" ? l.law : null, title: str(l.title) ?? id, customer: str(l.customer), price: num(l.price), publishedAt: str(l.publishedAt), deadline: str(l.deadline), region: str(l.region), method: str(l.method), url: str(l.url) }];
      })
    : [];
  return {
    listings,
    loadedAt: str(raw?.loadedAt) ?? "",
    filters: {
      query: typeof f.query === "string" ? f.query : EMPTY_FILTERS.query,
      law: f.law === "44" || f.law === "223" ? f.law : "any",
      priceFrom: num(f.priceFrom),
      priceTo: num(f.priceTo),
      publishedFrom: str(f.publishedFrom),
      publishedTo: str(f.publishedTo),
      activeOnly: typeof f.activeOnly === "boolean" ? f.activeOnly : EMPTY_FILTERS.activeOnly,
      titleOnly: typeof f.titleOnly === "boolean" ? f.titleOnly : false,
      customer: typeof f.customer === "string" ? f.customer : "",
      region: typeof f.region === "string" ? f.region : "",
      method: typeof f.method === "string" ? f.method : "",
    },
    sort: SORTS.includes(raw?.sort as TenderSort) ? (raw!.sort as TenderSort) : "deadline",
  };
}

export async function getTenders(): Promise<SavedTenders | undefined> {
  const record = await transaction<Stored | undefined>([STORES.ric], "readonly", (tx) => tx.objectStore(STORES.ric).get(KEY));
  return record ? normalizeTenders(record) : undefined;
}

export async function saveTenders(data: SavedTenders): Promise<void> {
  const record: Stored = { ...data, id: KEY, savedAt: new Date().toISOString() };
  await transaction<void>([STORES.ric], "readwrite", (tx) => {
    tx.objectStore(STORES.ric).put(record);
  });
}

export async function clearTenders(): Promise<void> {
  await transaction<void>([STORES.ric], "readwrite", (tx) => {
    tx.objectStore(STORES.ric).delete(KEY);
  });
}
