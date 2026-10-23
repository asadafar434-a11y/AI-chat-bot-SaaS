// Предложения поставщиков, которые заказчик собрал для обоснования начальной цены: в его документе строки «ТКП №1 — 9 305 651,64», «ТКП №2 — …», «ТКП №3 — …».
// Код читает их без ИИ: цены, разброс и то, по какому из них заказчик взял начальную цену (по числам, а не по словам).
//
// Это цены, по которым поставщики готовы продать заказчику, — с наценкой поставщика, не себестоимость участника; и их дал заказчику его поставщик, поэтому
// они не независимы. Ориентир «на каком уровне цены у других», не закупочная цена (price-basis.ts): в рейтинг и расчёт цены не входят.

import type { FindingLine } from "@/lib/analytics-summary";
import { cellsOf } from "@/lib/spec-table";

type Doc = { name: string; text: string };

export type CustomerQuote = { label: string; price: number };
export type CustomerQuotes = {
  doc: string;
  quotes: CustomerQuote[];
  min: number;
  max: number;
  mean: number;
  /** На сколько процентов самое дорогое предложение выше самого дешёвого. */
  spreadPct: number;
  /** Как названа цена в документе: без НДС, с НДС; null — не сказано или сказано и так и так. */
  vat: "without" | "with" | null;
};

// «ТКП №1», «КП № 2», «Коммерческое предложение №3»; номер обязателен — без него это просто слова.
const LABEL = /(?:^|[\s,;(])(?:(ткп)|(кп)|(коммерческ[а-яё]+\s+предложени[а-яё]+))\s*(?:№|N|#)?\s*(\d{1,2})(?![\d,.]*\d)/i;
const MIN_PRICE = 100;
const MAX_QUOTES = 12;

function priceOf(cell: string): number | null {
  const m = cell
    .replace(/[  ]/g, " ")
    .trim()
    .match(/^(\d[\d ]*(?:[.,]\d{1,2})?)\s*(?:₽|руб[а-яё.]*|р\.)?$/i);
  if (!m) return null;
  const n = Number(m[1].replace(/ /g, "").replace(",", "."));
  return Number.isFinite(n) && n >= MIN_PRICE ? n : null;
}

function vatOf(text: string): CustomerQuotes["vat"] {
  const without = /без\s+(?:учета|учёта)?\s*НДС/i.test(text);
  const withVat = /с\s+(?:учетом|учётом)\s+НДС|включая\s+НДС/i.test(text);
  return without && !withVat ? "without" : withVat && !without ? "with" : null;
}

/** Предложения поставщиков из документов заказчика: не меньше двух строк «ТКП/КП №N» с ценой в первой таблице документа. Нет такого — null. */
export function findCustomerQuotes(documents: Doc[]): CustomerQuotes | null {
  for (const doc of documents) {
    const found: CustomerQuote[] = [];
    const seen = new Set<string>();
    for (const line of doc.text.split("\n")) {
      if (!line.includes(" | ") && !line.includes("\t")) continue;
      const cells = cellsOf(line);
      const at = cells.findIndex((c) => LABEL.test(c));
      if (at < 0) continue;
      const m = LABEL.exec(cells[at])!;
      const label = `${m[3] ? "КП" : m[1] ? "ТКП" : "КП"} №${m[4]}`;
      // Тот же номер второй раз — началась следующая таблица (другая позиция): цены разных таблиц не смешиваем.
      if (seen.has(label)) break;
      const price = cells.slice(at + 1).map(priceOf).find((p) => p !== null);
      if (price === undefined || price === null) continue;
      seen.add(label);
      found.push({ label, price });
      if (found.length >= MAX_QUOTES) break;
    }
    if (found.length < 2) continue;
    const prices = found.map((q) => q.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return {
      doc: doc.name,
      quotes: found,
      min,
      max,
      mean: Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100,
      spreadPct: ((max - min) / min) * 100,
      vat: vatOf(doc.text),
    };
  }
  return null;
}

/** По какому из предложений заказчик взял начальную цену: сравниваем числа с точностью до копейки. Не совпало ни с одним — null. */
export function quoteBasis(q: CustomerQuotes, nmck: number | null): "min" | "mean" | "max" | null {
  if (nmck === null) return null;
  const same = (a: number) => Math.abs(a - nmck) <= 0.011;
  if (same(q.min)) return "min";
  if (same(q.max)) return "max";
  if (same(q.mean)) return "mean";
  return null;
}

const glue = (t: string) => t.replace(/[  ]/g, " ");
const money = (n: number) => glue(`${n.toLocaleString("ru-RU", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} ₽`);
export const quotePercent = (n: number) => glue(`${n.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
export const quoteMoney = money;

export const BASIS_TEXT = { min: "взята по минимальному предложению", mean: "равна среднему из предложений", max: "равна самому высокому предложению" } as const;

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "предложение" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "предложения" : "предложений");

/** Строка подписи внизу экрана. */
export function quotesFinding(q: CustomerQuotes, nmck: number | null): FindingLine {
  const basis = quoteBasis(q, nmck);
  return {
    label: "Предложения поставщиков",
    text: `у заказчика ${q.quotes.length} ${plural(q.quotes.length)}: от ${money(q.min)} до ${money(q.max)}, разброс ${quotePercent(q.spreadPct)}${basis ? `; начальная цена ${BASIS_TEXT[basis]}` : ""} — это цены продажи заказчику, не ваша себестоимость`,
    tone: "muted",
  };
}

export const quotesCount = (n: number) => `${n} ${plural(n)}`;
