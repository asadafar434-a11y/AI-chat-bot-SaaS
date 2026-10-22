// Итоговая диаграмма разбора: только проценты и суммы, которые код считает из уже посчитанного — без ИИ и без новых допущений.
// Три картинки: из чего складывается цена (затраты, налог и обеспечение, риски, прибыль), риски в процентах от цены, прибыль при снижении цены.
// «Процент победы» не рисуем: для него нужна история торгов (решение владельца, шаг 8 плана). Матрица из 27 проверок — скоро.

import { percent, rubles } from "@/lib/analytics-summary";
import type { MatrixSummary } from "@/lib/check-matrix";
import type { EconResult, LineGroup, Scenario } from "@/lib/economics";
import type { RicResult } from "@/lib/indicative-price";
import type { EstimateResult } from "@/lib/risk-estimate";

export const SCENARIO_LABELS: Record<Scenario, string> = { optimistic: "Оптимистичный", base: "Базовый", stress: "Стрессовый" };

export const PART_LABELS: Record<LineGroup | "profit", string> = {
  costs: "Ваши затраты",
  taxes: "Налог и обеспечение",
  risks: "Риски по договору",
  profit: "Прибыль",
};

export type PartId = LineGroup | "profit";
export type PricePart = { id: PartId; label: string; amount: number; /** Доля цены, %. */ pct: number; items: { label: string; amount: number }[] };

export type PriceBar = {
  scenario: Scenario;
  price: number;
  /** Части полосы по порядку: затраты, налог и обеспечение, риски, прибыль. Нулевые не берутся. */
  parts: PricePart[];
  /** Сумма частей полосы: цена, а при убытке больше цены на сумму убытка. */
  total: number;
  profit: number;
  profitPct: number;
  /** Убыток по сценарию: рубли и доля цены; null — убытка нет. */
  loss: { amount: number; pct: number } | null;
  /** Где на полосе цена, % её длины; null — полоса и есть цена (убытка нет). */
  priceAt: number | null;
};

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const GROUPS: LineGroup[] = ["costs", "taxes", "risks"];

// Полоса «цена = затраты + налог и обеспечение + риски + прибыль». При убытке прибыли нет: полоса длиннее цены, метка стоит там, где кончается цена.
export function priceBar(econ: EconResult, scenario: Scenario): PriceBar | null {
  if (!econ.ready) return null;
  const sc = econ.scenarios[scenario];
  const price = econ.price;
  const parts: PricePart[] = [];
  for (const id of GROUPS) {
    const items = sc.lines.filter((l) => l.group === id).map((l) => ({ label: l.label, amount: l.amount }));
    const amount = round2(items.reduce((sum, l) => sum + l.amount, 0));
    if (amount > 0) parts.push({ id, label: PART_LABELS[id], amount, pct: (amount / price) * 100, items });
  }
  if (sc.profit > 0) parts.push({ id: "profit", label: PART_LABELS.profit, amount: sc.profit, pct: (sc.profit / price) * 100, items: [] });
  const total = round2(parts.reduce((sum, p) => sum + p.amount, 0));
  const loss = sc.profit < 0 ? { amount: round2(-sc.profit), pct: (-sc.profit / price) * 100 } : null;
  return { scenario, price, parts, total, profit: sc.profit, profitPct: sc.margin, loss, priceAt: loss ? (price / total) * 100 : null };
}

export type RiskShare = { id: string; title: string; amount: number; pct: number; basis: string };
export type RiskShares = {
  shown: RiskShare[];
  /** Оценённые риски, что не поместились в список: сколько и на какую сумму. */
  rest: { count: number; amount: number };
  /** Суммы нет, нужны данные: что запросить. */
  unknown: { title: string; ask: string }[];
  total: number;
  totalPct: number | null;
};

// Риски, входящие в итог, — от большего к меньшему, каждый как доля цены. Изменение объёма — не потеря, в итог и на диаграмму не идёт.
export function riskShares(estimate: EstimateResult, limit = 8): RiskShares {
  const all = estimate.items
    .filter((i) => i.inTotal && i.amount !== null && i.pct !== null)
    .map((i) => ({ id: i.id, title: i.title, amount: i.amount!, pct: i.pct!, basis: i.basis }))
    .sort((a, b) => b.amount - a.amount);
  const rest = all.slice(limit);
  return {
    shown: all.slice(0, limit),
    rest: { count: rest.length, amount: round2(rest.reduce((sum, r) => sum + r.amount, 0)) },
    unknown: estimate.items.filter((i) => i.amount === null).map((i) => ({ title: i.title, ask: i.ask ?? "" })),
    total: estimate.total,
    totalPct: estimate.totalPct,
  };
}

export type CurvePoint = { drop: number; price: number; base: number; stress: number };
export type Curve = {
  points: CurvePoint[];
  /** Снижение от начальной цены, % — где стоит цена, от которой считаны сценарии; null — цена за краем графика. */
  currentDrop: number | null;
  /** Цены из экономики: подпись, цена и снижение от начальной, %. Снижение больше края графика — на нём точки нет, но в списке она есть. */
  marks: { id: "min" | "safe" | "target"; label: string; price: number; drop: number }[];
};

export function profitCurve(econ: EconResult): Curve | null {
  if (!econ.ready) return null;
  const maxDrop = econ.table[econ.table.length - 1]?.drop ?? 0;
  const drop = (price: number) => (1 - price / econ.nmck) * 100;
  const current = round2(drop(econ.price));
  const candidates: { id: "min" | "safe" | "target"; label: string; price: number | null }[] = [
    { id: "min", label: "Не ниже", price: econ.min },
    { id: "safe", label: "Безопасная", price: econ.safe },
    { id: "target", label: "Целевая", price: econ.target },
  ];
  const marks = candidates.flatMap((m) => (m.price === null ? [] : [{ id: m.id, label: m.label, price: m.price, drop: drop(m.price) }]));
  return { points: econ.table, currentDrop: current >= 0 && current <= maxDrop ? current : null, marks };
}

export type ChartFact = { id: string; label: string; value: string; hint: string };

// Проценты для карточек над диаграммой: только те, что есть из реальных данных.
export function chartFacts({ econ, estimate, ric, matrix }: { econ: EconResult; estimate: EstimateResult; ric: RicResult | null; matrix?: MatrixSummary }): ChartFact[] {
  const out: ChartFact[] = [];
  if (econ.ready) {
    out.push({ id: "margin", label: "Рентабельность", value: percent(econ.scenarios.base.margin), hint: `Прибыль к цене ${rubles(econ.price)} в базовом сценарии` });
    const drop = (1 - econ.price / econ.nmck) * 100;
    out.push({ id: "drop", label: "Снижение от начальной цены", value: percent(drop), hint: `Цена ${rubles(econ.price)} против начальной ${rubles(econ.nmck)}` });
  }
  if (estimate.totalPct !== null && estimate.total > 0) {
    out.push({ id: "risks", label: "Риски к цене", value: `до ${percent(estimate.totalPct)}`, hint: `Если сработают все оценённые риски: до ${rubles(estimate.total)}` });
  }
  if (ric && ric.complete && ric.deviation) {
    out.push({
      id: "ric",
      label: "Начальная цена против РИЦ",
      value: `${ric.deviation.pct > 0 ? "+" : ""}${percent(ric.deviation.pct)}`,
      hint: "Плюс — начальная цена выше рыночного ориентира",
    });
  }
  if (matrix) {
    const done = matrix.program + matrix.manual;
    out.push({
      id: "checks",
      label: "Проверено проверок",
      value: `${done} из ${matrix.total}`,
      hint: `${percent(matrix.coveragePct)}: в порядке ${matrix.ok}, внимание ${matrix.attention}, риск ${matrix.risk}; остальные ждут данных`,
    });
  }
  return out;
}

// Отметки оси: круглые числа (1, 2, 5 × 10ⁿ), ноль всегда внутри оси.
export function niceTicks(min: number, max: number, count = 5): number[] {
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  if (hi === lo) return [0];
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  const first = Math.floor(lo / step);
  const last = Math.ceil(hi / step);
  const ticks: number[] = [];
  for (let k = first; k <= last; k++) ticks.push(k * step);
  return ticks;
}

// Короткая подпись суммы на оси: «300 тыс.», «1,2 млн», «−73 тыс.».
export function compactRub(n: number): string {
  const fmt = (x: number) => x.toLocaleString("ru-RU", { maximumFractionDigits: 1 }).replace(/[\u00a0\u202f]/g, " ");
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1e6) return `${sign}${fmt(a / 1e6)} млн`;
  if (a >= 1e3) return `${sign}${fmt(a / 1e3)} тыс.`;
  return `${sign}${fmt(a)}`;
}
