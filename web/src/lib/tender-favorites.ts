import { STORES, transaction } from "@/lib/db";
import { normalizeListing } from "@/lib/tender-normalize";
import type { TenderListing } from "@/lib/tender-search";

// «Избранное» в «Поиске закупок»: закупки, которые участник отметил сердечком. Хранится в браузере, в хранилище расчётов (как выгрузка поиска), «Удалить все данные» стирает его вместе с остальными.
// Закупка сохраняется целиком, как была на момент отметки: сервер удаляет закончившиеся закупки, а в избранном она остаётся.

const KEY = "tender-favorites#list";

export type Favorite = { listing: TenderListing; addedAt: string };
type Stored = { id: string; items: Favorite[]; savedAt: string };

/** Из хранилища приводим к форме: испорченная запись пропускается, а не ломает экран; новые отметки сверху. */
export function normalizeFavorites(raw: unknown): Favorite[] {
  const items = Array.isArray((raw as { items?: unknown } | null)?.items) ? ((raw as { items: unknown[] }).items) : [];
  const seen = new Set<string>();
  const out: Favorite[] = [];
  for (const item of items) {
    const rec = item as { listing?: unknown; addedAt?: unknown } | null;
    const listing = normalizeListing(rec?.listing);
    if (!listing || seen.has(listing.id)) continue;
    seen.add(listing.id);
    out.push({ listing, addedAt: typeof rec?.addedAt === "string" && rec.addedAt !== "" ? rec.addedAt : "" });
  }
  return out.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export const isFavorite = (items: Favorite[], id: string): boolean => items.some((f) => f.listing.id === id);

/** Сердечко: закупки в избранном нет — добавляется сверху, есть — убирается. */
export function toggleFavorite(items: Favorite[], listing: TenderListing, now: string): Favorite[] {
  return isFavorite(items, listing.id) ? items.filter((f) => f.listing.id !== listing.id) : [{ listing, addedAt: now }, ...items];
}

export async function getFavorites(): Promise<Favorite[]> {
  const record = await transaction<Stored | undefined>([STORES.ric], "readonly", (tx) => tx.objectStore(STORES.ric).get(KEY));
  return record ? normalizeFavorites(record) : [];
}

export async function saveFavorites(items: Favorite[]): Promise<void> {
  const record: Stored = { id: KEY, items, savedAt: new Date().toISOString() };
  await transaction<void>([STORES.ric], "readwrite", (tx) => {
    tx.objectStore(STORES.ric).put(record);
  });
}
