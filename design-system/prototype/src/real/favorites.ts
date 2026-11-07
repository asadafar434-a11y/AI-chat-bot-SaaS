import { useEffect, useSyncExternalStore } from 'react';
import { getFavorites, isFavorite, saveFavorites, toggleFavorite, type Favorite } from '@/lib/tender-favorites';
import type { TenderListing } from '@/lib/tender-search';

// Избранное — одно на весь экран продукта: «Поиск закупок» и «Избранное» читают один и тот же список, сердечко на одной карточке сразу видно на другой.
// Лежит в браузере (lib/tender-favorites.ts). Пока не прочитано — список пуст, а сохранение до чтения не идёт, чтобы не затереть сохранённое пустым.

let items: Favorite[] = [];
let loaded = false;
let loading = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function load() {
  if (loaded || loading) return;
  loading = true;
  void getFavorites()
    .then((saved) => {
      // Что успели отметить, пока читалось, не теряем.
      const fresh = items.filter((f) => !saved.some((s) => s.listing.id === f.listing.id));
      items = [...fresh, ...saved];
      if (fresh.length > 0) void saveFavorites(items).catch(() => {});
    })
    .catch(() => {})
    .finally(() => {
      loaded = true;
      loading = false;
      emit();
    });
}

export function useFavorites(): { items: Favorite[]; ready: boolean; has: (id: string) => boolean; toggle: (l: TenderListing) => void } {
  useEffect(load, []);
  const current = useSyncExternalStore(subscribe, () => items);
  const ready = useSyncExternalStore(subscribe, () => loaded);
  return {
    items: current,
    ready,
    has: (id) => isFavorite(current, id),
    toggle: (l) => {
      items = toggleFavorite(items, l, new Date().toISOString());
      emit();
      if (loaded) void saveFavorites(items).catch(() => {});
    },
  };
}
