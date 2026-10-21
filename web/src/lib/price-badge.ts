// Ценовой бейдж: насколько начальная цена заказчика отличается от рыночного ориентира (РИЦ, lib/indicative-price.ts). Считает код, без ИИ и без «мнения».
// Четыре статуса. Бейдж «ниже» или «выше рынка» ставится, только если по каждой позиции есть не меньше пяти сопоставимых цен, цены однородны, а начальная цена
// и вышла за диапазон цен-аналогов, и отклонилась от РИЦ на порог или больше. Не хватает данных — «Недостаточно данных», категоричного бейджа нет.
// Пороги — настройки методики (RIC_METHOD.badge и настройка участника), не часть экрана. Вывод бейджа — не обвинение заказчика, а повод проверить характеристики, объёмы и условия.

import { RIC_METHOD, toBase, type RicData, type RicResult } from "@/lib/indicative-price";

export type BadgeStatus = "below" | "above" | "within" | "insufficient";

export const BADGE_TITLES: Record<BadgeStatus, string> = {
  below: "Цена существенно ниже рынка",
  above: "Цена существенно выше рынка",
  within: "Цена в рыночном диапазоне",
  insufficient: "Недостаточно данных для оценки цены",
};

export type BadgeDetail = {
  nmck: number;
  ric: number;
  /** Рыночная медиана закупки: сумма «медиана цены × количество» по позициям. */
  median: number;
  range: { from: number; to: number };
  abs: number;
  pct: number;
  /** Сопоставимых цен: наименьшее число по позиции и всего. */
  observations: { min: number; total: number };
  dates: { from: string; to: string };
  sources: string[];
  confidence: "medium" | "high";
  threshold: number;
};

export type PriceBadge = {
  status: BadgeStatus;
  title: string;
  /** Чего не хватает, когда оценки нет. */
  missing: string[];
  detail: BadgeDetail | null;
};

const MAX_MISSING = 3;

export function priceBadge(result: RicResult, data: RicData): PriceBadge {
  const { minObservations, highObservations, highVariation } = RIC_METHOD.badge;
  const missing: string[] = [];
  if (result.total === 0) missing.push("Нет позиций закупки.");
  if (result.total > 0 && result.nmck === null) missing.push("Не указана начальная цена закупки.");
  if (result.total > 0 && !result.complete) missing.push(`Цена посчитана не у всех позиций: у ${result.counted} из ${result.total}.`);
  for (const p of result.positions) {
    const label = p.position.name.trim() || "позиция без названия";
    if (p.used < minObservations) missing.push(`«${label}»: сопоставимых цен ${p.used}, нужно не меньше ${minObservations}.`);
    else if (p.status === "heterogeneous") missing.push(`«${label}»: цены неоднородны, разброс выше допустимого.`);
  }
  const insufficient = (): PriceBadge => ({
    status: "insufficient",
    title: BADGE_TITLES.insufficient,
    missing: missing.length > MAX_MISSING ? [...missing.slice(0, MAX_MISSING), `…и ещё ${missing.length - MAX_MISSING}.`] : missing,
    detail: null,
  });
  if (missing.length > 0 || !result.deviation || !result.range || result.ric === null || result.nmck === null) return insufficient();

  const used = result.positions.flatMap((p) => p.checks.filter((c) => c.state === "used"));
  const dates = used.map((c) => c.analog.date).sort();
  const sources = [...new Set(used.map((c) => c.analog.source.trim()))].slice(0, 8);
  const median = result.positions.reduce((s, p) => s + toBase(p.stats!.median, data.settings) * p.qty!, 0);
  const minUsed = Math.min(...result.positions.map((p) => p.used));
  const maxCv = Math.max(...result.positions.map((p) => p.stats!.cv));
  const threshold = data.settings.badgePct;
  const { abs, pct } = result.deviation;

  const status: BadgeStatus =
    result.nmck < result.range.from && pct <= -threshold ? "below" : result.nmck > result.range.to && pct >= threshold ? "above" : "within";
  return {
    status,
    title: BADGE_TITLES[status],
    missing: [],
    detail: {
      nmck: result.nmck,
      ric: result.ric,
      median: Math.round((median + Number.EPSILON) * 100) / 100,
      range: result.range,
      abs,
      pct,
      observations: { min: minUsed, total: used.length },
      dates: { from: dates[0], to: dates[dates.length - 1] },
      sources,
      confidence: minUsed >= highObservations && maxCv <= highVariation && result.staleCount === 0 ? "high" : "medium",
      threshold,
    },
  };
}
