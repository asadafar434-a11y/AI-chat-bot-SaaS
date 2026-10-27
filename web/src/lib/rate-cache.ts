import type { RateKind, RateObservation } from "@/lib/rate-extract";
import type { RateItem } from "@/lib/rates-request";
import type { ResourceNeed } from "@/lib/resource-need";

// Найденные в интернете зарплаты и аренда хранятся у закупки (в браузере, рядом с найденными ценами): годны две недели (зарплаты и аренда меняются медленнее цен на товары),
// потом ищутся заново. Поиск идёт порциями; что уже найдено, не ищется повторно. Неудача (поиск не ответил) повторяется через десять минут один раз.

export type RateResult = {
  key: string;
  kind: RateKind;
  observations: RateObservation[];
  pagesRead: number;
  pagesSeen: number;
  pagesWithNumbers: number;
  onRequest: number;
  rejected: number;
  reasons: string[];
  /** Сколько раз по позиции искали. */
  tries?: number;
};
export type SavedRates = { at: string; signature: string; results: RateResult[]; spentRub: number; error?: string };

export const RATES_TTL_DAYS = 14;
export const RATE_RETRY_AFTER_MS = 10 * 60 * 1000;
export const MAX_RATE_TRIES = 2;

/** Позиции для поиска из состава исполнения; регион один на все. Ключ стабилен: «s:должность» и «e:техника». */
export function rateItems(need: ResourceNeed, region: string | null): RateItem[] {
  return [
    ...need.staff.map((s) => ({ key: `s:${s.role}`, kind: "salary" as const, subject: s.role, region })),
    ...need.equipment.map((e) => ({ key: `e:${e.name}`, kind: "rent" as const, subject: e.name, region })),
  ];
}

/** Подпись состава: изменился состав или регион — прежний поиск не годится. */
export function ratesSignature(items: RateItem[]): string {
  return items.map((i) => `${i.key}@${i.region ?? ""}`).join("|");
}

const ageMs = (saved: SavedRates, now: Date) => now.getTime() - Date.parse(saved.at);
export const ratesFresh = (saved: SavedRates | null | undefined, now: Date): boolean => !!saved && Number.isFinite(Date.parse(saved.at)) && ageMs(saved, now) < RATES_TTL_DAYS * 86_400_000;

/** Позиции, которые ещё надо искать: у сохранённого другая подпись или срок вышел — все; иначе те, по которым записи нет или поиск ничего не вернул (поиск молчал) и пора повторить. */
export function pendingItems(items: RateItem[], saved: SavedRates | null | undefined, now: Date): RateItem[] {
  if (!saved || saved.signature !== ratesSignature(items) || !ratesFresh(saved, now)) return items;
  const byKey = new Map(saved.results.map((r) => [r.key, r]));
  return items.filter((i) => {
    const r = byKey.get(i.key);
    if (!r) return true;
    const silent = r.observations.length === 0 && r.pagesSeen === 0;
    return silent && (r.tries ?? 1) < MAX_RATE_TRIES && ageMs(saved, now) >= RATE_RETRY_AFTER_MS;
  });
}

/** Новые результаты порции поверх сохранённых: по ключу заменяются, остальные остаются; найденное не теряется. */
export function mergeRates(saved: SavedRates | null | undefined, batch: RateResult[], signature: string, spentRub: number, at: string): SavedRates {
  const base = saved && saved.signature === signature && ratesFresh(saved, new Date(at)) ? saved.results : [];
  const byKey = new Map(base.map((r) => [r.key, r]));
  for (const r of batch) {
    const before = byKey.get(r.key);
    const keep = before && before.observations.length > 0 && r.observations.length === 0 ? before : r;
    byKey.set(r.key, { ...keep, tries: (before?.tries ?? 0) + 1 });
  }
  const total = (saved && saved.signature === signature ? saved.spentRub : 0) + spentRub;
  return { at: saved && saved.signature === signature && ratesFresh(saved, new Date(at)) ? saved.at : at, signature, results: [...byKey.values()], spentRub: Math.round(total * 100) / 100 };
}

const isObservation = (o: unknown): o is RateObservation => {
  const x = (o ?? {}) as Record<string, unknown>;
  return (x.kind === "salary" || x.kind === "rent") && typeof x.monthly === "number" && Number.isFinite(x.monthly) && typeof x.host === "string" && typeof x.url === "string" && typeof x.quote === "string" && typeof x.subject === "string";
};

/** Сохранённое в браузере может быть старше или повреждено: берём только то, что понимаем. */
export function normalizeRates(raw: unknown): SavedRates | undefined {
  const x = (raw ?? {}) as Record<string, unknown>;
  if (typeof x.at !== "string" || typeof x.signature !== "string" || !Array.isArray(x.results)) return undefined;
  const results: RateResult[] = x.results.flatMap((r) => {
    const y = (r ?? {}) as Record<string, unknown>;
    if (typeof y.key !== "string" || !(y.kind === "salary" || y.kind === "rent") || !Array.isArray(y.observations)) return [];
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return [
      {
        key: y.key,
        kind: y.kind,
        observations: y.observations.filter(isObservation).map((o) => ({ ...o, notes: Array.isArray(o.notes) ? o.notes.filter((s): s is string => typeof s === "string") : [] })),
        pagesRead: n(y.pagesRead),
        pagesSeen: n(y.pagesSeen),
        pagesWithNumbers: n(y.pagesWithNumbers),
        onRequest: n(y.onRequest),
        rejected: n(y.rejected),
        reasons: Array.isArray(y.reasons) ? y.reasons.filter((s): s is string => typeof s === "string").slice(0, 6) : [],
        ...(typeof y.tries === "number" && y.tries >= 1 && { tries: Math.min(Math.floor(y.tries), 9) }),
      },
    ];
  });
  return { at: x.at, signature: x.signature, results, spentRub: typeof x.spentRub === "number" ? x.spentRub : 0, ...(typeof x.error === "string" && { error: x.error }) };
}
