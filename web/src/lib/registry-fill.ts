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

/** Номера для заявки по позициям ТП: индекс товара, номер и реестр, из которого он взят. Позиции без подтверждённого и проверенного номера здесь нет. */
export function registryFillFor(purchase: RegistryPurchase, docs: DocText[], now = new Date()): { index: number; number: string; kind: RegistryKind }[] {
  const goods = purchase.tp?.goods ?? [];
  if (goods.length === 0 || !purchase.registry || Object.keys(purchase.registry.choices).length === 0) return [];
  const required = requiredRegistryOf(registryDemandOf(purchase, docs), purchase.registry);
  const cards = registryCardsOf(purchase, docs);
  const { lines } = autofillSummary(cards, purchase.registry ?? EMPTY_REGISTRY_STATE, required, asOfDate(purchase.deadline, now));
  return cards.filter((card) => lines.has(card.key)).map((card) => ({ index: goodsIndexOf(card.key), number: purchase.registry!.choices[card.key].registryNumber, kind: purchase.registry!.choices[card.key].registryKind }));
}

/** Номера для заявки по позициям ТП (индекс товара → номер). Позиция без подтверждённого и проверенного номера в таблице не появляется. */
export const registryNumbersFor = (purchase: RegistryPurchase, docs: DocText[], now = new Date()): Map<number, string> =>
  new Map(registryFillFor(purchase, docs, now).map((x) => [x.index, x.number]));

/** Реестры тех же номеров (индекс товара → реестр): от него зависит подпись строки в заявке. */
export const registryKindsFor = (purchase: RegistryPurchase, docs: DocText[], now = new Date()): Map<number, RegistryKind> =>
  new Map(registryFillFor(purchase, docs, now).map((x) => [x.index, x.kind]));

/** Закупка требует реестровый номер: документы назвали реестр (или участник когда-то указал его сам). Иначе жёлтого поля «впишите номер» в заявке нет. */
export const registryNeededFor = (purchase: RegistryPurchase, docs: DocText[]): boolean =>
  requiredRegistryOf(registryDemandOf(purchase, docs), purchase.registry) !== null;

type ViewGood = Pick<TpGood, "name" | "characteristics" | "quantity">;
type ViewTp = { goods: ViewGood[] };

// Товары ТП с номерами и без кода ОКПД; служебные поля подстановки наружу не идут.
function viewGoods<G extends ViewGood>(goods: G[], numbers: Map<number, string> | null, kinds: Map<number, RegistryKind> | null, needed: boolean): G[] {
  const marked = goods.map((g, i) => ({
    ...g,
    registryNeeded: needed,
    ...(numbers?.has(i) && { registryNumber: numbers.get(i), ...(kinds?.get(i) && { registryKind: kinds.get(i) }) }),
  }));
  return goodsWithRegistry(marked).map((g) => {
    const { registryNeeded: _needed, registryNumber: _number, registryKind: _kind, registryRejected: _rejected, ...rest } = g as Record<string, unknown>;
    void _needed;
    void _number;
    void _kind;
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
  const filled = registryFillFor(purchase, docs, now);
  const numbers = new Map(filled.map((x) => [x.index, x.number]));
  const kinds = new Map(filled.map((x) => [x.index, x.kind]));
  const needed = registryNeededFor(purchase, docs);
  const draft = purchase.tpDraft;
  return {
    tp: { ...tp, goods: viewGoods(tp.goods, numbers, kinds, needed) },
    tpDraft: draft ? { ...draft, goods: viewGoods(draft.goods, null, null, needed) } : undefined,
    numbers,
    needed,
  };
}
