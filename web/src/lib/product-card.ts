import { compact, okpd2In, lowerWords } from "@/lib/registry-text";
import type { TpGood } from "@/lib/tp";

// Карточка товара: что известно о товаре, который предлагает участник, и откуда это известно.
// Главное правило: наименование из ТЗ — это то, что хочет заказчик, а не доказательство того, что поставляет участник.
// Поэтому у каждого значения есть происхождение: «ТЗ» годится, чтобы НАЙТИ кандидатов в реестре, но не годится, чтобы
// ПОДТВЕРДИТЬ, что запись — именно товар участника. Подтверждают только то, что назвал сам участник или его документы.

export type FieldOrigin = "tz" | "user" | "document" | "profile";

export const ORIGIN_TEXT: Record<FieldOrigin, string> = {
  tz: "из документов закупки (хочет заказчик)",
  user: "указал участник",
  document: "из документа поставщика",
  profile: "из сохранённого товара — проверьте актуальность",
};

export type Sourced = { value: string; origin: FieldOrigin; source: string };

/** Что участник может указать про свой товар. */
export const CARD_FIELDS = ["manufacturer", "inn", "brand", "model", "article", "madeBy", "okpd2", "country", "characteristics", "registryNumber"] as const;
export type CardField = (typeof CARD_FIELDS)[number];

export const FIELD_LABELS: Record<CardField, string> = {
  manufacturer: "Производитель",
  inn: "ИНН производителя",
  brand: "Торговая марка",
  model: "Модель",
  article: "Артикул",
  madeBy: "ТУ или ГОСТ, по которому изготовлен",
  okpd2: "Код ОКПД2",
  country: "Страна происхождения",
  characteristics: "Характеристики товара",
  registryNumber: "Реестровый номер (если уже известен)",
};

/** Поля, которые отличают один товар от другого. Их назвал участник — тогда они подтверждают, что запись реестра — его товар. */
export const IDENTITY_FIELDS: CardField[] = ["inn", "manufacturer", "model", "article", "madeBy", "registryNumber"];

export type ProductCard = {
  /** Ключ позиции в закупке: номер строки и отпечаток наименования. Одинаковые наименования в разных строках — разные ключи. */
  key: string;
  /** Наименование из закупки — как в ТЗ. */
  name: string;
  quantity: string;
  /** Где в ТЗ эта позиция и дословная цитата. */
  source: string;
  quote: string;
  /** Как называет свой товар участник, если иначе, чем в ТЗ. */
  offeredName: Sourced | null;
  fields: Partial<Record<CardField, Sourced>>;
};

/** Что вписал участник: значения без происхождения (оно всегда «участник» либо «профиль»). */
export type CardEdits = Partial<Record<CardField | "offeredName", string>>;

/** Простой стабильный отпечаток строки (cyrb53): годится, чтобы заметить изменение, но не для защиты. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const positionKey = (index: number, name: string): string => `${index + 1}:${fingerprint(compact(name))}`;

const clean = (value: string | undefined | null) => (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

// ── Код ОКПД2 из документов закупки ──────────────────────────────────────────────────────────────

export type DocText = { name: string; text: string };

const LABELED = /ОКПД\s*[-–]?\s*2?[^\d\n]{0,40}?(\d{2}\.\d{2}(?:\.\d{1,3}){0,2})/giu;

const labeledCodes = (text: string): string[] => {
  const out: string[] = [];
  for (const m of text.matchAll(LABELED)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
};

const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase().replace(/ё/g, "е");

/**
 * Код ОКПД2 позиции. Три уровня доверия: код в той же строке ТЗ, что и наименование; единственный подписанный код рядом
 * с позицией; единственный подписанный код во всех документах закупки. Несколько разных кодов — не выбираем, оставляем пусто.
 */
export function harvestOkpd2(good: { name: string; quote: string }, docs: DocText[]): { code: string; source: string } | null {
  const needles = [good.quote, good.name].map((s) => norm(clean(s))).filter((s) => s.length >= 4);
  for (const doc of docs) {
    const lines = doc.text.split(/\n/);
    for (const line of lines) {
      const flat = norm(line);
      if (!needles.some((n) => flat.includes(n.slice(0, 80)))) continue;
      const codes = okpd2In(line).filter((c) => c.split(".").length >= 3 || /ОКПД/i.test(line));
      const distinct = [...new Set(codes)];
      if (distinct.length === 1) return { code: distinct[0], source: `${doc.name}: в строке с наименованием` };
    }
    const flatDoc = norm(doc.text);
    for (const needle of needles) {
      const at = flatDoc.indexOf(needle.slice(0, 80));
      if (at === -1) continue;
      // Рядом — в пределах следующих 600 знаков до следующей позиции.
      const codes = labeledCodes(doc.text.slice(Math.max(0, at - 150), at + needle.length + 600));
      if (codes.length === 1) return { code: codes[0], source: `${doc.name}: код ОКПД2 рядом с позицией` };
    }
  }
  const all = [...new Set(docs.flatMap((d) => labeledCodes(d.text)))];
  if (all.length === 1) return { code: all[0], source: "документы закупки: единственный указанный код ОКПД2" };
  return null;
}

/** Карточки позиций из перечня товаров ТП. Всё, что здесь взято из ТЗ, помечено origin «tz». */
export function cardsFromGoods(goods: Pick<TpGood, "name" | "quantity" | "source" | "quote">[], docs: DocText[], edits: Record<string, CardEdits> = {}): ProductCard[] {
  return goods.map((good, index) => {
    const key = positionKey(index, good.name);
    const card: ProductCard = {
      key,
      name: clean(good.name),
      quantity: clean(good.quantity),
      source: clean(good.source),
      quote: clean(good.quote),
      offeredName: null,
      fields: {},
    };
    const found = harvestOkpd2({ name: good.name, quote: good.quote }, docs);
    if (found) card.fields.okpd2 = { value: found.code, origin: "tz", source: found.source };
    return applyEdits(card, edits[key]);
  });
}

/** Наложение того, что вписал участник: его значения важнее ТЗ и считаются подтверждающими. */
export function applyEdits(card: ProductCard, edits: CardEdits | undefined): ProductCard {
  if (!edits) return card;
  const next: ProductCard = { ...card, fields: { ...card.fields } };
  for (const [field, raw] of Object.entries(edits) as [CardField | "offeredName", string | undefined][]) {
    const value = clean(raw);
    if (!value) continue;
    if (field === "offeredName") next.offeredName = { value, origin: "user", source: "указал участник" };
    else if ((CARD_FIELDS as readonly string[]).includes(field)) next.fields[field] = { value: field === "inn" ? value.replace(/\s+/g, "") : value, origin: "user", source: "указал участник" };
  }
  return next;
}

/** Что именно сказал о своём товаре участник: перечень полей, которые подтверждают тождество. */
export function identityFieldsOf(card: ProductCard): CardField[] {
  return IDENTITY_FIELDS.filter((field) => {
    const f = card.fields[field];
    return !!f && f.origin !== "tz" && f.value.length > 0;
  });
}

/** Отпечаток сведений о товаре: изменились — прежний выбор реестровой записи перестаёт быть проверенным. */
export function cardHash(card: ProductCard): string {
  const parts: string[] = [card.name, card.offeredName?.value ?? ""];
  for (const field of CARD_FIELDS) {
    const f = card.fields[field];
    parts.push(f ? `${f.origin}:${f.value}` : "");
  }
  return fingerprint(parts.join("\u0001"));
}

/** Слова, по которым искать в названиях реестра: то, как участник называет свой товар, иначе — наименование ТЗ. */
export const searchName = (card: ProductCard): string => card.offeredName?.value || card.name;

export const searchWords = (card: ProductCard): string[] => lowerWords(searchName(card));
