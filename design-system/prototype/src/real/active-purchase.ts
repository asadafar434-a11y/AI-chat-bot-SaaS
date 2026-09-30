import { useSyncExternalStore } from 'react';
import type { Purchase } from '@/lib/purchase';
import type { SentDocument } from '@/lib/read-documents';

// Закупка, открытая на экране сейчас. Её видит и ассистент в окне чата, хотя живёт он вне закупки: вопросы к ИИ идут
// по документам этой закупки, а история переписки хранится в ней же (purchase.chat). Закупку закрыли — ассистент
// снова отвечает на общие вопросы.
export type ActivePurchase = {
  purchase: Purchase;
  documents: SentDocument[];
  update: (patch: Partial<Purchase>) => void;
};

let current: ActivePurchase | null = null;
const listeners = new Set<() => void>();

export function setActivePurchase(next: ActivePurchase | null) {
  current = next;
  listeners.forEach((listener) => listener());
}

export const useActivePurchase = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
