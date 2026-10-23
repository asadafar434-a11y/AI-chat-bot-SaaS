// Живой поиск закупочных цен при разборе закупки (решение владельца 22.10.2026: «загрузил — аналитика сама ищет в интернете, без лишних кнопок; цены всегда по факту»): когда искать, что помнить и что показывать.
// Найденное хранится у самой закупки с датой и годно неделю: цены в интернете быстро устаревают, а каждый поиск стоит денег (платная модель), поэтому один и тот же разбор заново не оплачивается.
// Неудача (поиск не ответил, ИИ выключен) помнится час, чтобы не повторять платные попытки при каждом открытии экрана. Чистые правила без сети: их проверяют тесты (npm test).

import type { FindingLine } from "@/lib/analytics-summary";
import { parseAmount, type RicPosition } from "@/lib/indicative-price";
import type { Observation } from "@/lib/market-observations";
import { MAX_PRICE_POSITIONS } from "@/lib/prices-request";

export const PRICES_TTL_DAYS = 7;
export const FAILURE_TTL_MS = 60 * 60 * 1000;
const DAY = 86_400_000;

// pagesSeen / pagesWithPrice / reasons — для подписи, почему цен нет: сколько страниц просмотрено, на скольких было что-то похожее на цену, почему отклонены предложения (у прежних записей их нет).
// tries — сколько раз искали по этой позиции (повтор после блокировки поиска — retryKeys); у прежних записей его нет, это одна попытка.
export type PriceResult = { key: string; observations: Observation[]; pagesRead: number; rejected: number; pagesSeen?: number; pagesWithPrice?: number; reasons?: string[]; tries?: number };

/** Что сохранено у закупки. error — последняя неудача; results пусты, если искали, но ничего не нашлось. */
export type SavedPrices = {
  at: string;
  /** Подпись набора позиций: изменились позиции — искать заново. */
  signature: string;
  results: PriceResult[];
  spentRub: number;
  error?: string;
  /** Когда в последний раз повторяли поиск по позициям, по которым он ничего не вернул. */
  retriedAt?: string;
};

export type PriceState = "off" | "no-positions" | "searching" | "done" | "failed";

/** Позиции, по которым ищем: самые крупные по сумме (количество × начальная цена за единицу), без суммы — по порядку в бланке; не больше четырёх. */
export function pickPositions(positions: RicPosition[], max = MAX_PRICE_POSITIONS): RicPosition[] {
  const usable = positions.filter((p) => p.name.trim().length >= 2);
  const value = (p: RicPosition) => {
    const qty = parseAmount(p.qty);
    return qty !== null && p.customerUnit !== undefined ? qty * p.customerUnit : -1;
  };
  return usable
    .map((p, i) => ({ p, i, v: value(p) }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, max)
    .map((x) => x.p);
}

export const signatureOf = (positions: Pick<RicPosition, "id" | "name" | "unit">[]) => positions.map((p) => `${p.id}|${p.name.trim().toLowerCase()}|${p.unit.trim().toLowerCase()}`).join("§");

/** Нужно ли искать заново: нет сохранённого, позиции изменились, прошла неделя; после неудачи — не раньше чем через час. */
export function shouldSearch(saved: SavedPrices | null | undefined, signature: string, now: Date): boolean {
  if (!saved || saved.signature !== signature) return true;
  const age = now.getTime() - Date.parse(saved.at);
  if (!Number.isFinite(age)) return true;
  return saved.error ? age >= FAILURE_TTL_MS : age >= PRICES_TTL_DAYS * DAY;
}

// Поиск по позиции ничего не вернул (ни одной страницы) — чаще всего бесплатный поиск заблокировал запрос. Такие позиции ищутся ещё раз: через десять минут, потом через час, потом через шесть часов — четыре попытки всего;
// найденное по другим позициям не трогается. Пока блокировка не спала, чаще пробовать бесполезно.
export const RETRY_DELAYS_MS = [10 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000];
export const RETRY_AFTER_MS = RETRY_DELAYS_MS[0];
export const MAX_SEARCH_TRIES = RETRY_DELAYS_MS.length + 1;

const retryable = (r: PriceResult) => r.observations.length === 0 && r.pagesSeen === 0 && (r.tries ?? 1) < MAX_SEARCH_TRIES;
const delayOf = (r: PriceResult) => RETRY_DELAYS_MS[Math.min((r.tries ?? 1) - 1, RETRY_DELAYS_MS.length - 1)];

// Повторять можно и после неудачи целиком (поиск заблокирован, error), пока записи нет недели.
const withinTtl = (saved: SavedPrices, now: Date) => {
  const age = now.getTime() - Date.parse(saved.at);
  return Number.isFinite(age) && age >= 0 && age < PRICES_TTL_DAYS * DAY;
};

/** Когда можно повторить поиск хотя бы по одной позиции без страниц: null — повторять нечего. */
export function nextRetryAt(saved: SavedPrices | null | undefined, now: Date): number | null {
  if (!saved || !withinTtl(saved, now)) return null;
  const left = saved.results.filter(retryable);
  const base = Date.parse(saved.retriedAt ?? saved.at);
  return left.length > 0 && Number.isFinite(base) ? base + Math.min(...left.map(delayOf)) : null;
}

/** Ключи позиций, по которым поиск пора повторить. */
export function retryKeys(saved: SavedPrices | null | undefined, now: Date): string[] {
  if (!saved || !withinTtl(saved, now)) return [];
  const base = Date.parse(saved.retriedAt ?? saved.at);
  return Number.isFinite(base) ? saved.results.filter((r) => retryable(r) && now.getTime() >= base + delayOf(r)).map((r) => r.key) : [];
}

/** Результат повтора: по повторённым позициям — новый (попыток на одну больше), остальное как было; траты складываются. */
export function mergeRetry(saved: SavedPrices, fresh: SavedPrices, keys: string[], at: string): SavedPrices {
  const byKey = new Map(fresh.results.map((r) => [r.key, r]));
  const results = saved.results.map((r) => (keys.includes(r.key) ? { ...(byKey.get(r.key) ?? r), tries: (r.tries ?? 1) + 1 } : r));
  // Поиск ответил (хоть одна страница или найденная цена) — прежняя неудача снимается; нет — остаётся.
  const answered = results.some((r) => r.observations.length > 0 || (r.pagesSeen ?? 0) > 0);
  const { error: oldError, ...rest } = saved;
  return {
    ...rest,
    ...(!answered && oldError && { error: oldError }),
    retriedAt: at,
    spentRub: Math.round((saved.spentRub + fresh.spentRub) * 100) / 100,
    results,
  };
}

/** Найденные цены годны, пока не прошла неделя: старше — в расчёт не идут. */
export const isFresh = (saved: SavedPrices | null | undefined, now: Date): boolean => {
  if (!saved || saved.error) return false;
  const age = now.getTime() - Date.parse(saved.at);
  return Number.isFinite(age) && age >= 0 && age < PRICES_TTL_DAYS * DAY;
};

const dayText = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};

const plural = (n: number, one: string, few: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

/** Строка подписи внизу экрана: что нашлось (или почему не искали), без лишних слов. */
/** highlights — готовые строки о ценах по позициям («Уголь»: медиана…, диапазон…, цен N) из lib/market-merge.ts: если они есть, в подписи видны сами цены, а не только их число. */
/** Почему цен нет — фактами: сколько страниц просмотрено, на скольких было что-то похожее на цену, сколько предложений отклонено и по какой причине. Прежние записи без этих чисел — как раньше. */
function noPricesText(saved: SavedPrices | null | undefined, when: string): string {
  const rs = saved?.results ?? [];
  const read = rs.reduce((s, r) => s + r.pagesRead, 0);
  if (!rs.some((r) => r.pagesSeen !== undefined)) return `в интернете подходящих цен не нашла (${when}, страниц прочитано: ${read})`;
  const seen = rs.reduce((s, r) => s + (r.pagesSeen ?? 0), 0);
  const withPrice = rs.reduce((s, r) => s + (r.pagesWithPrice ?? 0), 0);
  const rejected = rs.reduce((s, r) => s + r.rejected, 0);
  const reasons = [...new Set(rs.flatMap((r) => r.reasons ?? []))];
  const parts = [`страниц просмотрено ${seen}`, withPrice > 0 ? `с ценой на странице ${withPrice}` : "цены на страницах не выложены"];
  if (rejected > 0) parts.push(`отклонено ${rejected}${reasons.length > 0 ? ` (${reasons.join(", ")})` : ""}`);
  return `подходящих цен в интернете не нашла (${when}): ${parts.join(", ")}`;
}

export function priceSearchFinding(i: { state: PriceState; saved?: SavedPrices | null; note?: string; highlights?: string[] }): FindingLine {
  const label = "Закупочные цены";
  switch (i.state) {
    case "off":
      return { label, text: "ИИ выключен — цены в интернете не искались", tone: "muted" };
    case "no-positions":
      return i.note ? { label, text: i.note, tone: "warn" } : { label, text: "в документах нет списка позиций — искать нечего", tone: "muted" };
    case "searching":
      return { label, text: "ищу в интернете…", tone: "muted" };
    case "failed":
      return { label, text: i.note ?? "поиск не удался — повторю позже", tone: "muted" };
    case "done": {
      const saved = i.saved;
      const found = saved?.results.reduce((s, r) => s + r.observations.length, 0) ?? 0;
      const positions = saved?.results.filter((r) => r.observations.length > 0).length ?? 0;
      const when = saved ? `на ${dayText(saved.at)}` : "";
      if (found === 0) return { label, text: noPricesText(saved, when), tone: "muted" };
      // Позиции, по которым цены не нашлись; если поиск по позиции вообще ничего не вернул — вероятно, бесплатный поиск заблокировал запрос.
      const empty = saved?.results.filter((r) => r.observations.length === 0) ?? [];
      const silent = empty.filter((r) => r.pagesSeen === 0).length;
      const missing = empty.length > 0 ? `; без цены: ${empty.length} ${plural(empty.length, "позиция", "позиции", "позиций")}${silent > 0 ? ` (по ${silent} поиск ничего не вернул — возможно, бесплатный поиск заблокирован)` : ""}` : "";
      if (i.highlights && i.highlights.length > 0) return { label, text: `${i.highlights.slice(0, 3).join("; ")} · ${when}${missing}`, tone: "good" };
      return { label, text: `найдено ${found} ${plural(found, "цена", "цены", "цен")} по ${positions} ${plural(positions, "позиции", "позициям", "позициям")} ${when}${missing}; пересчёт — раз в ${PRICES_TTL_DAYS} дней`, tone: "good" };
    }
  }
}

const isObservation = (o: unknown): o is Observation => {
  const x = (o ?? {}) as Record<string, unknown>;
  return typeof x.key === "string" && typeof x.name === "string" && typeof x.unit === "string" && Array.isArray(x.tokens) && typeof x.priceNoVat === "number" && Number.isFinite(x.priceNoVat) && typeof x.observedAt === "string" && typeof x.source === "string" && typeof x.hash === "string";
};

/** Сохранённое в браузере может быть старше или повреждено: берём только то, что понимаем. */
export function normalizePrices(raw: unknown): SavedPrices | undefined {
  const x = (raw ?? {}) as Record<string, unknown>;
  if (typeof x.at !== "string" || typeof x.signature !== "string" || !Array.isArray(x.results)) return undefined;
  const results: PriceResult[] = x.results.flatMap((r) => {
    const y = (r ?? {}) as Record<string, unknown>;
    if (typeof y.key !== "string" || !Array.isArray(y.observations)) return [];
    const reasons = Array.isArray(y.reasons) ? y.reasons.filter((s): s is string => typeof s === "string").slice(0, 6) : [];
    return [
      {
        key: y.key,
        observations: y.observations.filter(isObservation),
        pagesRead: typeof y.pagesRead === "number" ? y.pagesRead : 0,
        rejected: typeof y.rejected === "number" ? y.rejected : 0,
        ...(typeof y.pagesSeen === "number" && { pagesSeen: y.pagesSeen }),
        ...(typeof y.pagesWithPrice === "number" && { pagesWithPrice: y.pagesWithPrice }),
        ...(typeof y.tries === "number" && y.tries >= 1 && { tries: Math.min(Math.floor(y.tries), 9) }),
        ...(reasons.length > 0 && { reasons }),
      },
    ];
  });
  return { at: x.at, signature: x.signature, results, spentRub: typeof x.spentRub === "number" ? x.spentRub : 0, ...(typeof x.error === "string" && { error: x.error }), ...(typeof x.retriedAt === "string" && { retriedAt: x.retriedAt }) };
}
