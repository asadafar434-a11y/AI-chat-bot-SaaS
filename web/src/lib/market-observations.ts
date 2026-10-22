// Рыночные ценовые наблюдения: цена за единицу с источником, датой, регионом и количеством; нормализация, отбор сопоставимых и расчёт рыночного ориентира.
// Данные накапливаются в общей базе (таблица PriceObservation, lib/market-store.ts) из реальных источников: выгрузки реестра контрактов ЕИС, прайс-листы, таблицы закупок. Источника и даты нет — наблюдения нет.
// Считает код: среднее, медиана, рыночный диапазон, динамика и различия по регионам — только когда данных достаточно; иначе «недостаточно данных» с причиной. Ничего не выдумывается.
// Сопоставимость: та же единица, цифры в названии совпадают (мощность, размер, марка), остальные слова похожи, объёмы различаются не больше чем втрое, цена не старше окна.
// Это ориентир для сравнения цен, а не оценка стоимости конкретного поставщика: характеристики сверяются по названию, глубже программа их не разбирает.
// Модуль без зависимостей от браузера и сервера: его проверяют тесты (npm test).

import { MONEY_OUT, guessRoles, parseDateCell, parseMoney, parseTable } from "@/lib/analog-import";
import { RIC_METHOD, statsOf, type Analog, type Vat } from "@/lib/indicative-price";

export type SourceKind = "eis_contract" | "price_list" | "tender_docs" | "other";

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  eis_contract: "реестр контрактов ЕИС",
  price_list: "прайс-лист",
  tender_docs: "документы закупки",
  other: "другой источник",
};

export type Observation = {
  /** Ключ позиции: слова названия (основы, по алфавиту) и единица. */
  key: string;
  name: string;
  /** Единица измерения в короткой форме («шт», «кг», «т», «м2»); пусто — не названа. */
  unit: string;
  okpd2: string | null;
  tokens: string[];
  /** Цена за единицу без НДС, ₽. */
  priceNoVat: number;
  /** День цены (дата контракта или прайса), ГГГГ-ММ-ДД. */
  observedAt: string;
  region: string | null;
  quantity: number | null;
  /** Откуда цена: «ЕИС, контракт № …», имя файла и строка. */
  source: string;
  sourceKind: SourceKind;
  hash: string;
};

// ——— Нормализация названия и единицы ———

const UNITS: Record<string, string> = {
  шт: "шт", штука: "шт", штуки: "шт", штук: "шт", "шт.": "шт",
  кг: "кг", килограмм: "кг", "кг.": "кг",
  т: "т", тн: "т", тонна: "т", тонны: "т", тонн: "т", "т.": "т",
  г: "г", грамм: "г",
  л: "л", литр: "л", литры: "л", литров: "л", "л.": "л",
  м: "м", метр: "м", "п.м": "м", "пог.м": "м", "пог. м": "м", "м.п": "м",
  м2: "м2", "м²": "м2", "кв.м": "м2", "кв. м": "м2", "кв м": "м2",
  м3: "м3", "м³": "м3", "куб.м": "м3", "куб. м": "м3", "куб м": "м3",
  компл: "компл", комплект: "компл", "компл.": "компл",
  усл: "усл", услуга: "усл", "усл.": "усл",
  чел: "чел", человек: "чел",
  ч: "ч", час: "ч", часов: "ч",
  сут: "сут", сутки: "сут", "сут.": "сут",
  мес: "мес", месяц: "мес", "мес.": "мес",
  упак: "упак", упаковка: "упак", "упак.": "упак",
  рейс: "рейс",
};

export function normalizeUnit(raw: string): string {
  const t = String(raw ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return UNITS[t] ?? UNITS[t.replace(/\s+/g, "")] ?? t.replace(/[^a-zа-я0-9²³]/g, "");
}

const STOP = new Set(["для", "и", "в", "на", "с", "по", "из", "к", "от", "до", "без", "или", "при", "под", "над", "за", "не", "тип", "типа", "вид", "вида", "марка", "марки"]);

/** Слова названия: нижний регистр, без «ё», основа слова — первые пять букв (падежи и числа сходятся: «угля», «уголь»); цифры целиком. */
export function tokensOf(name: string): string[] {
  const words = String(name ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/(\d),(\d)/g, "$1.$2")
    .split(/[^a-zа-я0-9.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
  const out = new Set<string>();
  for (const w of words) {
    if (/^\d/.test(w)) out.add(w);
    else if (w.length >= 2 && !STOP.has(w)) out.add(w.length > 5 ? w.slice(0, 5) : w);
  }
  return [...out].sort();
}

export const keyOf = (name: string, unit: string) => `${tokensOf(name).join(" ")}|${normalizeUnit(unit)}`;

/** Короткая устойчивая сумма строки (cyrb53): ключ повтора, не криптография. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export const hashOf = (o: Pick<Observation, "key" | "priceNoVat" | "observedAt" | "source">) =>
  cyrb53(`${o.key}|${o.priceNoVat.toFixed(4)}|${o.observedAt}|${o.source.toLowerCase().replace(/\s+/g, " ").trim()}`);

// ——— Сборка наблюдения ———

export type RawObservation = {
  name: string;
  unit?: string;
  /** Цена за единицу как в источнике. */
  price: number;
  vat: Vat;
  vatRate: number;
  date: string;
  region?: string | null;
  quantity?: number | null;
  okpd2?: string | null;
  source: string;
  sourceKind: SourceKind;
};

export type Built = { ok: true; value: Observation } | { ok: false; reason: string };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function makeObservation(raw: RawObservation): Built {
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (name.length < 2) return { ok: false, reason: "нет названия позиции" };
  if (!Number.isFinite(raw.price) || raw.price <= 0) return { ok: false, reason: "цена не число или не больше нуля" };
  if (!ISO_DAY.test(raw.date) || Number.isNaN(Date.parse(`${raw.date}T00:00:00Z`))) return { ok: false, reason: "нет даты цены — без неё наблюдение не принимается" };
  const source = String(raw.source ?? "").trim().slice(0, 500);
  if (!source) return { ok: false, reason: "не назван источник цены" };
  const priceNoVat = raw.vat === "with" ? raw.price / (1 + raw.vatRate / 100) : raw.price;
  const unit = normalizeUnit(raw.unit ?? "");
  const tokens = tokensOf(name);
  if (tokens.length === 0) return { ok: false, reason: "в названии нет слов для сравнения" };
  const base = {
    key: `${tokens.join(" ")}|${unit}`.slice(0, 300),
    name,
    unit,
    okpd2: raw.okpd2?.trim() || null,
    tokens,
    priceNoVat: Math.round(priceNoVat * 10000) / 10000,
    observedAt: raw.date,
    region: raw.region?.trim().slice(0, 120) || null,
    quantity: raw.quantity != null && Number.isFinite(raw.quantity) && raw.quantity > 0 ? raw.quantity : null,
    source,
    sourceKind: raw.sourceKind,
  };
  return { ok: true, value: { ...base, hash: hashOf(base) } };
}

export type TableMeta = { source: string; sourceKind: SourceKind; unit?: string; region?: string | null; defaultVat: Vat; vatRate?: number };

/** Таблица (выгрузка ЕИС, Excel, прайс — вставленный текст или CSV) → наблюдения. Название, цена и дата обязательны; чего нет — строка пропускается с причиной. */
export function observationsFromTable(text: string, meta: TableMeta): { observations: Observation[]; skipped: { line: number; reason: string }[] } {
  const rows = parseTable(text);
  const { hasHeader, roles } = guessRoles(rows);
  const col = (role: string) => roles.indexOf(role as never);
  const at = (r: string[], role: string) => (col(role) >= 0 ? (r[col(role)] ?? "").trim() : "");
  const data = hasHeader ? rows.slice(1) : rows;
  const offset = hasHeader ? 2 : 1;
  const observations: Observation[] = [];
  const skipped: { line: number; reason: string }[] = [];
  const seen = new Set<string>();
  data.forEach((r, i) => {
    const line = i + offset;
    let price = parseMoney(at(r, "price"));
    const qty = parseMoney(at(r, "qty"));
    if (price === null && col("total") >= 0) {
      const total = parseMoney(at(r, "total"));
      if (total !== null && qty !== null && qty > 0) price = total / qty;
    }
    if (price === null) return void skipped.push({ line, reason: "цена за единицу не найдена" });
    const date = parseDateCell(at(r, "date"));
    if (!date) return void skipped.push({ line, reason: "нет даты цены" });
    const vatCell = at(r, "vat");
    const vat: Vat = vatCell === "" ? meta.defaultVat : /без/i.test(vatCell) ? "without" : "with";
    const rawSource = at(r, "source");
    const source = /^\d{19}$/.test(rawSource) ? `ЕИС, контракт № ${rawSource}` : rawSource ? rawSource.slice(0, 200) : `${meta.source}, строка ${line}`;
    const built = makeObservation({ name: at(r, "name"), unit: meta.unit, price, vat, vatRate: meta.vatRate ?? RIC_METHOD.vatRate, date, region: meta.region, quantity: qty, source, sourceKind: meta.sourceKind });
    if (!built.ok) return void skipped.push({ line, reason: built.reason });
    if (seen.has(built.value.hash)) return void skipped.push({ line, reason: "повтор в файле: такая же цена, дата и источник" });
    seen.add(built.value.hash);
    observations.push(built.value);
  });
  return { observations, skipped };
}

// ——— Сопоставимость ———

export type Target = {
  name: string;
  unit?: string;
  /** Количество в закупке: наблюдения с несопоставимым объёмом (больше чем втрое) не берутся. */
  quantity?: number | null;
  region?: string | null;
};

export const MARKET_METHOD = {
  /** Слова названия, не считая цифр: доля общих слов, с которой позиции считаются одной. */
  minSimilarity: 0.6,
  /** Объёмы различаются не больше чем во столько раз. */
  maxVolumeRatio: 3,
  /** Цена старше стольких дней в расчёт не идёт. */
  windowDays: 365,
  /** Динамика: недавние цены — последние столько дней, прежние — до года перед ними. */
  recentDays: 180,
  earlierDays: 360,
  /** Для динамики и региона — не меньше стольких цен в каждой части. */
  minPart: 3,
  /** Меньше сопоставимых цен — вывода нет (как у ценового бейджа). */
  minObservations: RIC_METHOD.badge.minObservations,
  maxVariation: RIC_METHOD.maxVariation,
} as const;

const isNumeric = (t: string) => /^\d/.test(t);

export type Comparable = { ok: true } | { ok: false; reason: "unit" | "characteristics" | "words" | "volume" };

export function comparable(target: Target, o: Observation): Comparable {
  if (normalizeUnit(target.unit ?? "") !== o.unit) return { ok: false, reason: "unit" };
  const a = tokensOf(target.name);
  const b = o.tokens;
  const an = a.filter(isNumeric);
  const bn = b.filter(isNumeric);
  if (an.length !== bn.length || an.some((t, i) => t !== bn[i])) return { ok: false, reason: "characteristics" };
  const aw = new Set(a.filter((t) => !isNumeric(t)));
  const bw = new Set(b.filter((t) => !isNumeric(t)));
  const common = [...aw].filter((t) => bw.has(t)).length;
  const union = new Set([...aw, ...bw]).size;
  if (union === 0 || common / union < MARKET_METHOD.minSimilarity) return { ok: false, reason: "words" };
  if (target.quantity && o.quantity) {
    const ratio = target.quantity > o.quantity ? target.quantity / o.quantity : o.quantity / target.quantity;
    if (ratio > MARKET_METHOD.maxVolumeRatio) return { ok: false, reason: "volume" };
  }
  return { ok: true };
}

// ——— Статистика ———

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const medianOf = (values: number[]) => statsOf(values)?.median ?? 0;
const pctChange = (from: number, to: number) => (from > 0 ? ((to - from) / from) * 100 : 0);

export type MarketStats = {
  status: "ok" | "heterogeneous" | "insufficient";
  /** Сопоставимых цен в окне. */
  n: number;
  mean: number | null;
  median: number | null;
  /** Рыночный диапазон: от 10-го до 90-го процентиля при десяти и больше ценах, иначе от минимума до максимума. */
  range: { from: number; to: number } | null;
  /** Коэффициент вариации цен. */
  cv: number | null;
  /** Недавние цены против прежних, если в каждой части не меньше трёх цен. */
  dynamics: { changePct: number; recent: { n: number; median: number }; earlier: { n: number; median: number } } | null;
  /** Регионы, в которых не меньше трёх цен; разница с медианой по всем регионам. */
  regional: { region: string; n: number; median: number; diffPct: number }[];
  /** Различия по регионам, если назван регион закупки и по нему есть данные. */
  targetRegion: { region: string; n: number; median: number; diffPct: number } | null;
  sources: string[];
  dates: { from: string; to: string } | null;
  /** Почему вывода нет или он осторожный. */
  missing: string[];
};

const EMPTY: MarketStats = { status: "insufficient", n: 0, mean: null, median: null, range: null, cv: null, dynamics: null, regional: [], targetRegion: null, sources: [], dates: null, missing: [] };

/** Среднее, медиана, диапазон, динамика и регионы по сопоставимым наблюдениям на дату `onDate`. Данных мало — «недостаточно данных» с причиной. */
export function marketStats(target: Target, all: Observation[], onDate: string): MarketStats {
  const fit = all.filter((o) => comparable(target, o).ok);
  const age = (o: Observation) => daysBetween(o.observedAt, onDate);
  const windowed = fit.filter((o) => age(o) >= 0 && age(o) <= MARKET_METHOD.windowDays);
  if (windowed.length < MARKET_METHOD.minObservations) {
    const older = fit.length - windowed.length;
    return {
      ...EMPTY,
      n: windowed.length,
      missing: [
        `нужно не меньше ${MARKET_METHOD.minObservations} сопоставимых цен за ${MARKET_METHOD.windowDays} дней, найдено ${windowed.length}`,
        ...(older > 0 ? [`ещё ${older} цен вне окна: старше года или позже даты расчёта`] : []),
      ],
    };
  }
  const values = windowed.map((o) => o.priceNoVat);
  const st = statsOf(values)!;
  const sorted = [...values].sort((a, b) => a - b);
  const range = windowed.length >= 10 ? { from: percentile(sorted, 0.1), to: percentile(sorted, 0.9) } : { from: st.min, to: st.max };

  const recent = fit.filter((o) => age(o) >= 0 && age(o) <= MARKET_METHOD.recentDays).map((o) => o.priceNoVat);
  const earlier = fit.filter((o) => age(o) > MARKET_METHOD.recentDays && age(o) <= MARKET_METHOD.recentDays + MARKET_METHOD.earlierDays).map((o) => o.priceNoVat);
  const dynamics =
    recent.length >= MARKET_METHOD.minPart && earlier.length >= MARKET_METHOD.minPart
      ? { changePct: pctChange(medianOf(earlier), medianOf(recent)), recent: { n: recent.length, median: medianOf(recent) }, earlier: { n: earlier.length, median: medianOf(earlier) } }
      : null;

  const byRegion = new Map<string, number[]>();
  for (const o of windowed) if (o.region) byRegion.set(o.region, [...(byRegion.get(o.region) ?? []), o.priceNoVat]);
  const regional = [...byRegion.entries()]
    .filter(([, v]) => v.length >= MARKET_METHOD.minPart)
    .map(([region, v]) => ({ region, n: v.length, median: medianOf(v), diffPct: pctChange(st.median, medianOf(v)) }))
    .sort((a, b) => b.n - a.n || a.region.localeCompare(b.region, "ru"));
  const targetRegion = target.region ? (regional.find((r) => r.region.toLowerCase() === target.region!.trim().toLowerCase()) ?? null) : null;

  const sources = [...new Set(windowed.map((o) => o.source))].slice(0, 10);
  const dates = windowed.map((o) => o.observedAt).sort();
  const heterogeneous = st.cv > MARKET_METHOD.maxVariation;
  return {
    status: heterogeneous ? "heterogeneous" : "ok",
    n: windowed.length,
    mean: st.mean,
    median: st.median,
    range,
    cv: st.cv,
    dynamics,
    regional,
    targetRegion,
    sources,
    dates: { from: dates[0], to: dates[dates.length - 1] },
    missing: heterogeneous ? [`цены неоднородны: коэффициент вариации ${(st.cv * 100).toFixed(0)} % выше ${(MARKET_METHOD.maxVariation * 100).toFixed(0)} % — вывод осторожный`] : [],
  };
}

/** Отбор сопоставимых наблюдений в цены-аналоги позиции для расчёта РИЦ (lib/indicative-price.ts): без НДС, с источником и датой, пометка «база» в источнике. */
export function analogsFrom(target: Target, all: Observation[], onDate: string, newId: () => string): Analog[] {
  return all
    .filter((o) => comparable(target, o).ok && daysBetween(o.observedAt, onDate) >= 0 && daysBetween(o.observedAt, onDate) <= MARKET_METHOD.windowDays)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
    .slice(0, 60)
    .map((o) => ({ id: newId(), price: MONEY_OUT(o.priceNoVat), vat: "without" as const, source: `База цен: ${o.source}`, date: o.observedAt }));
}
