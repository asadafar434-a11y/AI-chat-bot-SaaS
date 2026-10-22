// РИЦ — расчёт индикативной цены: рыночный ориентир по закупке из цен-аналогов (коммерческие предложения, прайсы, реестр контрактов).
// С ним сравнивают начальную цену заказчика. Это не цена заявки: цену заявки считает шаг «Цена». Считает код, без ИИ; модуль без зависимостей от браузера и сервера.
//
// Метод — сопоставимых рыночных цен, как в обосновании начальной цены у заказчика: цена единицы — среднее по аналогам, однородность — коэффициент вариации
// не выше 33 %, аналогов не меньше трёх. Эти пороги — настройка методики (RIC_METHOD), а не что-то зашитое в экран; сверять с методикой заказчика.
// Правила, чтобы не выдумывать: цена без источника и даты в расчёт не попадает; устаревшая (старше staleDays) считается, но помечена; аналог исключает только человек;
// сумма по закупке и отклонение от начальной цены показываются, только когда цена есть по каждой позиции.

import { baseUnitPrices, findSpecification } from "@/lib/spec-table";

export const RIC_METHOD = {
  /** Меньше аналогов — индикативную цену позиции не считаем. */
  minAnalogs: 3,
  /** Коэффициент вариации (СКО / среднее): выше — совокупность цен неоднородна. */
  maxVariation: 0.33,
  /** Цена старше стольких дней помечается «устарела». */
  staleDays: 180,
  /** Ставка НДС по умолчанию (с 01.01.2026); участник меняет её в настройках расчёта. */
  vatRate: 22,
  /** Ценовой бейдж («ниже рынка», «выше рынка», «в рынке»): стартовые настройки, их калибруют на реальных данных; порог участник меняет в настройках расчёта. */
  badge: {
    /** Меньше сопоставимых цен по любой позиции — бейджа нет, «недостаточно данных». */
    minObservations: 5,
    /** Отклонение начальной цены от РИЦ, с которого оно «существенное», %. */
    significantPct: 15,
    /** Уверенность «высокая»: цен по каждой позиции не меньше этого и вариация не выше порога ниже. */
    highObservations: 8,
    highVariation: 0.2,
  },
} as const;

export type Vat = "with" | "without";

/** Одна цена-аналог за единицу. Числа хранятся как введены («1 250,50»): при вводе ничего не переписывается. */
export type Analog = { id: string; price: string; vat: Vat; source: string; date: string; excluded?: boolean };

export type RicPosition = {
  id: string;
  name: string;
  unit: string;
  qty: string;
  analogs: Analog[];
  /** Начальная цена за единицу у заказчика (из его расчёта НМЦК), если она есть в документах. В той же основе НДС, что и НМЦ. */
  customerUnit?: number;
};

export type RicSettings = { vatRate: number; nmckVat: Vat; staleDays: number; badgePct: number };
/** Поправка на условия закупки или резерв на отраслевой риск (lib/ric-scenarios.ts): число и основание, откуда оно. id — из сценария сферы («delivery», «risk-materials») или «custom-…» для своей (тогда есть название и единица). */
export type RicAdjustment = { id: string; label?: string; unit?: "percent" | "rub"; value: string; basis: string };
/** scenario — сфера, выбранная участником; нет — программа определяет её по предмету закупки. */
export type RicData = { positions: RicPosition[]; settings: RicSettings; scenario?: string; adjustments?: RicAdjustment[] };

export const DEFAULT_SETTINGS: RicSettings = { vatRate: RIC_METHOD.vatRate, nmckVat: "with", staleDays: RIC_METHOD.staleDays, badgePct: RIC_METHOD.badge.significantPct };
export const EMPTY_RIC: RicData = { positions: [], settings: DEFAULT_SETTINGS };

// ——— Разбор введённого ———

/** «1 250,50» → 1250.5; не число — null. */
export function parseAmount(text: string): number | null {
  const t = String(text ?? "")
    .replace(/[\s  ]/g, "")
    .replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function dayOf(date: string): number | null {
  if (!DATE.test(date)) return null;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date ? null : Math.floor(t / 86_400_000);
}
const todayOf = (now: Date) => Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);

// ——— Статистика ———

export type Stats = { n: number; mean: number; median: number; min: number; max: number; stdev: number; cv: number };

/** Среднее, медиана, СКО по выборке (n − 1, как в методике) и коэффициент вариации. */
export function statsOf(values: number[]): Stats | null {
  const n = values.length;
  if (n === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, x) => s + x, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const stdev = n > 1 ? Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, median, min: sorted[0], max: sorted[n - 1], stdev, cv: mean > 0 ? stdev / mean : 0 };
}

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

// ——— Расчёт по позиции ———

export type AnalogState = "used" | "excluded" | "invalid";
export type AnalogCheck = {
  analog: Analog;
  state: AnalogState;
  /** Почему цена не учтена. */
  reason?: string;
  /** Цена за единицу без НДС — только у учтённых. */
  unitNoVat?: number;
  stale?: boolean;
};

/** ok — аналогов хватает и цены однородны; heterogeneous — аналогов хватает, но разброс выше предела; insufficient — аналогов меньше минимума. */
export type PositionStatus = "ok" | "heterogeneous" | "insufficient";

export type PositionResult = {
  position: RicPosition;
  checks: AnalogCheck[];
  used: number;
  stats: Stats | null;
  status: PositionStatus;
  qty: number | null;
  /** Индикативная цена единицы, без НДС и в основе НМЦ (то же с НДС или без — как у начальной цены). */
  unitNoVat: number | null;
  unit: number | null;
  /** Сумма по позиции в основе НМЦ и диапазон по крайним аналогам; null — нет цены или количества. */
  total: number | null;
  range: { from: number; to: number } | null;
  staleCount: number;
  /** Если разброс высокий и аналогов хватает: какой аналог убрать, чтобы вариация стала допустимой. Решает человек. */
  suggest: { analogId: string; cv: number } | null;
  /** Начальная цена за единицу заказчика против индикативной: рубли и проценты (плюс — заказчик выше). */
  customer: { abs: number; pct: number } | null;
};

export function checkAnalogs(position: RicPosition, settings: RicSettings, now: Date): AnalogCheck[] {
  const today = todayOf(now);
  return position.analogs.map((analog): AnalogCheck => {
    if (analog.excluded) return { analog, state: "excluded", reason: "исключена вами" };
    const price = parseAmount(analog.price);
    if (price === null || price <= 0) return { analog, state: "invalid", reason: "цена не указана" };
    if (!analog.source.trim()) return { analog, state: "invalid", reason: "не указан источник" };
    const day = dayOf(analog.date);
    if (day === null) return { analog, state: "invalid", reason: "не указана дата" };
    if (day > today) return { analog, state: "invalid", reason: "дата в будущем" };
    const unitNoVat = analog.vat === "with" ? price / (1 + settings.vatRate / 100) : price;
    return { analog, state: "used", unitNoVat, stale: today - day > settings.staleDays };
  });
}

/** Цена без НДС → в основе начальной цены (с НДС или без). */
export const toBase = (noVat: number, settings: RicSettings) => (settings.nmckVat === "with" ? noVat * (1 + settings.vatRate / 100) : noVat);
const inBase = toBase;

export function computePosition(position: RicPosition, settings: RicSettings, now: Date): PositionResult {
  const checks = checkAnalogs(position, settings, now);
  const values = checks.filter((c) => c.state === "used").map((c) => c.unitNoVat!);
  const stats = statsOf(values);
  const qty = parseAmount(position.qty);
  const enough = values.length >= RIC_METHOD.minAnalogs;
  const status: PositionStatus = !enough ? "insufficient" : stats!.cv > RIC_METHOD.maxVariation ? "heterogeneous" : "ok";

  let suggest: PositionResult["suggest"] = null;
  if (status === "heterogeneous" && values.length - 1 >= RIC_METHOD.minAnalogs) {
    const usedChecks = checks.filter((c) => c.state === "used");
    usedChecks.forEach((c, at) => {
      const rest = statsOf(values.filter((_, i) => i !== at));
      if (rest && rest.cv <= RIC_METHOD.maxVariation && (!suggest || rest.cv < suggest.cv)) suggest = { analogId: c.analog.id, cv: rest.cv };
    });
  }

  const unitNoVat = enough ? stats!.mean : null;
  const unit = unitNoVat === null ? null : inBase(unitNoVat, settings);
  const total = unit !== null && qty !== null && qty > 0 ? unit * qty : null;
  const range = enough && qty !== null && qty > 0 ? { from: inBase(stats!.min, settings) * qty, to: inBase(stats!.max, settings) * qty } : null;
  const customer =
    unit !== null && position.customerUnit !== undefined && position.customerUnit > 0
      ? { abs: position.customerUnit - unit, pct: ((position.customerUnit - unit) / unit) * 100 }
      : null;

  return {
    position,
    checks,
    used: values.length,
    stats,
    status,
    qty,
    unitNoVat,
    unit,
    total,
    range,
    staleCount: checks.filter((c) => c.state === "used" && c.stale).length,
    suggest,
    customer,
  };
}

// ——— Расчёт по закупке ———

export type RicResult = {
  positions: PositionResult[];
  /** Позиций с индикативной ценой и количеством / всего. */
  counted: number;
  total: number;
  /** Цена и количество есть по каждой позиции. Только тогда есть сумма и сравнение с начальной ценой. */
  complete: boolean;
  /** Полнота и однородность: каждая позиция — «ok». */
  reliable: boolean;
  /** Индикативная цена закупки в основе НМЦ (с НДС или без — как у начальной цены) и диапазон по крайним аналогам; null — расчёт неполный. */
  ric: number | null;
  range: { from: number; to: number } | null;
  /** Сумма по уже посчитанным позициям — показывается, пока расчёт неполный. */
  partial: number;
  nmck: number | null;
  /** Начальная цена против РИЦ: рубли и проценты от РИЦ (плюс — начальная цена выше). */
  deviation: { abs: number; pct: number } | null;
  staleCount: number;
};

export function computeRic(data: RicData, nmck: number | null, now: Date): RicResult {
  const positions = data.positions.map((p) => computePosition(p, data.settings, now));
  const counted = positions.filter((p) => p.total !== null);
  const complete = positions.length > 0 && counted.length === positions.length;
  const sum = (pick: (p: PositionResult) => number) => counted.reduce((s, p) => s + pick(p), 0);
  const ric = complete ? round2(sum((p) => p.total!)) : null;
  const range = complete ? { from: round2(sum((p) => p.range!.from)), to: round2(sum((p) => p.range!.to)) } : null;
  const deviation = ric !== null && ric > 0 && nmck !== null && nmck > 0 ? { abs: round2(nmck - ric), pct: ((nmck - ric) / ric) * 100 } : null;
  return {
    positions,
    counted: counted.length,
    total: positions.length,
    complete,
    reliable: complete && positions.every((p) => p.status === "ok"),
    ric,
    range,
    partial: round2(sum((p) => p.total!)),
    nmck,
    deviation,
    staleCount: positions.reduce((s, p) => s + p.staleCount, 0),
  };
}

// ——— Позиции из документов и защита от чужой формы данных ———

type Doc = { name: string; text: string };

/** Позиции из бланка заказчика «Спецификация» или «Расчёт цены» и его начальные цены за единицу — всё, что заказчик уже написал; аналогов у позиций ещё нет. */
export function positionsFromDocuments(documents: Doc[]): { doc: string; title: string; positions: RicPosition[]; vatRate: number | null } | null {
  const spec = findSpecification(documents);
  if (!spec) return null;
  const prices = baseUnitPrices(spec.rows, documents);
  return {
    doc: spec.doc,
    title: spec.title,
    vatRate: spec.vatRate,
    positions: spec.rows.map((row, i) => ({
      id: `doc-${i + 1}`,
      name: row.name,
      unit: row.unit,
      qty: String(row.qty).replace(".", ","),
      analogs: [],
      ...(prices && { customerUnit: prices[i] }),
    })),
  };
}

const str = (x: unknown) => (typeof x === "string" ? x : "");

/** Данные из хранилища могут быть старше или повреждены: берём только то, что понимаем. */
export function normalizeRic(raw: unknown): RicData {
  const input = (raw && typeof raw === "object" ? raw : {}) as { positions?: unknown; settings?: Record<string, unknown>; scenario?: unknown; adjustments?: unknown };
  const s = input.settings ?? {};
  const settings: RicSettings = {
    vatRate: typeof s.vatRate === "number" && s.vatRate >= 0 && s.vatRate < 100 ? s.vatRate : DEFAULT_SETTINGS.vatRate,
    nmckVat: s.nmckVat === "without" ? "without" : "with",
    staleDays: typeof s.staleDays === "number" && s.staleDays > 0 ? s.staleDays : DEFAULT_SETTINGS.staleDays,
    badgePct: typeof s.badgePct === "number" && s.badgePct > 0 && s.badgePct < 100 ? s.badgePct : DEFAULT_SETTINGS.badgePct,
  };
  const positions = (Array.isArray(input.positions) ? input.positions : []).flatMap((p: Record<string, unknown>): RicPosition[] => {
    if (!p || typeof p !== "object" || typeof p.id !== "string") return [];
    const analogs = (Array.isArray(p.analogs) ? p.analogs : []).flatMap((a: Record<string, unknown>): Analog[] =>
      a && typeof a === "object" && typeof a.id === "string"
        ? [{ id: a.id, price: str(a.price), vat: a.vat === "without" ? "without" : "with", source: str(a.source), date: str(a.date), ...(a.excluded === true && { excluded: true }) }]
        : [],
    );
    return [{ id: p.id, name: str(p.name), unit: str(p.unit), qty: str(p.qty), analogs, ...(typeof p.customerUnit === "number" && p.customerUnit > 0 && { customerUnit: p.customerUnit }) }];
  });
  const scenario = typeof input.scenario === "string" && /^[a-z]{2,20}$/.test(input.scenario) ? input.scenario : undefined;
  const adjustments = (Array.isArray(input.adjustments) ? (input.adjustments as Record<string, unknown>[]) : []).flatMap((a): RicAdjustment[] => {
    if (!a || typeof a !== "object" || typeof a.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(a.id)) return [];
    const custom = a.id.startsWith("custom-");
    return [{ id: a.id, ...(custom && { label: str(a.label).slice(0, 120), unit: a.unit === "percent" ? ("percent" as const) : ("rub" as const) }), value: str(a.value).slice(0, 40), basis: str(a.basis).slice(0, 300) }];
  });
  return { positions, settings, ...(scenario && { scenario }), ...(adjustments.length > 0 && { adjustments }) };
}
