import { notifyDataChanged } from "@/lib/data-events";
import { fromStore, toStore } from "@/lib/data-format";
import { STORES, transaction } from "@/lib/db";
import { EMPTY_CARD, readCard, type CompanyCard } from "@/lib/company-card";

// Карточка компании лежит в браузере, как база доказательств: в копию данных входит, «Удалить все данные» стирает её вместе с остальными.
export const CARD_KEY = "company-card";

export async function getCompanyCard(): Promise<CompanyCard> {
  const stored = await transaction<unknown>([STORES.settings], "readonly", (tx) => tx.objectStore(STORES.settings).get(CARD_KEY));
  return stored === undefined ? EMPTY_CARD : readCard(fromStore<Partial<CompanyCard>>("companyCard", stored));
}

export async function saveCompanyCard(card: CompanyCard): Promise<void> {
  await transaction<void>([STORES.settings], "readwrite", (tx) => {
    tx.objectStore(STORES.settings).put(toStore("companyCard", card), CARD_KEY);
  });
  notifyDataChanged();
}
