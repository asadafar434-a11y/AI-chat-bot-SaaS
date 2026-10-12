import { cardsFromGoods, goodsIndexOf, type DocText, type ProductCard } from "@/lib/product-card";
import { detectRegistryDemand, type RegistryDemand } from "@/lib/registry-demand";
import { goodsWithRegistry } from "@/lib/registry-lines";
import { EMPTY_REGISTRY_STATE, autofillSummary, type RegistryState } from "@/lib/registry-log";
import { moscowDay, type RegistryKind } from "@/lib/registry-types";
import type { TpGood } from "@/lib/tp";

// Всё, что экран «Пакет» и сборка файлов берут из закупки про реестровые номера: карточки позиций, требование закупки,
// дата, на которую запись должна действовать, и номера, которые можно вписать в заявку.

export type RegistryPurchase = {
  tp?: { goods: Pick<TpGood, "name" | "quantity" | "source" | "quote">[] };
  registry?: RegistryState;
  deadline?: { date?: string };
};

// «Сегодня» — по Москве: в 01:00 по Москве в UTC ещё вчера.
const todayText = (now: Date) => moscowDay(now.toISOString());

/** Дата, на которую запись должна действовать: подача заявки — не позже срока окончания приёма, а прошедший срок заменяем сегодняшним днём. */
export function asOfDate(deadline: { date?: string } | undefined, now = new Date()): string {
  const today = todayText(now);
  const date = deadline?.date ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today ? date : today;
}

export function registryCardsOf(purchase: RegistryPurchase, docs: DocText[]): ProductCard[] {
  return cardsFromGoods(purchase.tp?.goods ?? [], docs, purchase.registry?.cards ?? {});
}

export function registryDemandOf(purchase: RegistryPurchase, docs: DocText[]): RegistryDemand {
  return detectRegistryDemand(docs, purchase.tp?.goods ?? []);
}

/**
 * Реестр, в котором искать: тот, что назвали документы закупки, а если не назвали — тот, что выбрал участник. Явный выбор
 * участника имеет силу и тогда, когда программа требование в документах не нашла: он мог знать о нём из другого источника.
 */
export const requiredRegistryOf = (demand: Pick<RegistryDemand, "registry" | "status">, state: RegistryState | undefined): RegistryKind | null =>
  demand.registry ?? state?.registry ?? null;

/** Номера для заявки по позициям ТП (индекс товара → номер). Позиция без подтверждённого и проверенного номера в таблице не появляется. */
export function registryNumbersFor(purchase: RegistryPurchase, docs: DocText[], now = new Date()): Map<number, string> {
  const goods = purchase.tp?.goods ?? [];
  const out = new Map<number, string>();
  if (goods.length === 0 || !purchase.registry || Object.keys(purchase.registry.choices).length === 0) return out;
  const demand = registryDemandOf(purchase, docs);
  const required = requiredRegistryOf(demand, purchase.registry);
  const cards = registryCardsOf(purchase, docs);
  const { lines } = autofillSummary(cards, purchase.registry ?? EMPTY_REGISTRY_STATE, required, asOfDate(purchase.deadline, now));
  for (const card of cards) {
    if (lines.has(card.key)) out.set(goodsIndexOf(card.key), purchase.registry.choices[card.key].registryNumber);
  }
  return out;
}

/** Закупка требует реестровый номер: документы назвали реестр или участник выбрал его сам. */
export const registryNeededFor = (purchase: RegistryPurchase, docs: DocText[]): boolean =>
  requiredRegistryOf(registryDemandOf(purchase, docs), purchase.registry) !== null;

type ViewGood = Pick<TpGood, "name" | "characteristics" | "quantity">;
type ViewTp = { goods: ViewGood[] };

// Товары ТП с номерами и без кода ОКПД; служебные поля подстановки наружу не идут.
function viewGoods<G extends ViewGood>(goods: G[], numbers: Map<number, string> | null, needed: boolean): G[] {
  const marked = goods.map((g, i) => ({ ...g, registryNeeded: needed, ...(numbers?.has(i) && { registryNumber: numbers.get(i) }) }));
  return goodsWithRegistry(marked).map((g) => {
    const { registryNeeded: _needed, registryNumber: _number, registryRejected: _rejected, ...rest } = g as Record<string, unknown>;
    void _needed;
    void _number;
    void _rejected;
    return rest as G;
  });
}

/**
 * ТП, как он виден на экране: без кода ОКПД, с реестровыми номерами. То же делается с исходным черновиком ИИ (но без номеров), чтобы
 * на месте номера в черновике стояло поле, а в ТП — его значение: так проверка полей считает это место заполненным участником.
 * Нет ТП или товаров — null.
 */
export function registryView<T extends ViewTp>(
  purchase: RegistryPurchase & { tp?: T; tpDraft?: T },
  docs: DocText[],
  now = new Date(),
): { tp: T; tpDraft: T | undefined; numbers: Map<number, string>; needed: boolean } | null {
  const tp = purchase.tp;
  if (!tp || tp.goods.length === 0) return null;
  const numbers = registryNumbersFor(purchase, docs, now);
  const needed = registryNeededFor(purchase, docs);
  const draft = purchase.tpDraft;
  return {
    tp: { ...tp, goods: viewGoods(tp.goods, numbers, needed) },
    tpDraft: draft ? { ...draft, goods: viewGoods(draft.goods, null, needed) } : undefined,
    numbers,
    needed,
  };
}
