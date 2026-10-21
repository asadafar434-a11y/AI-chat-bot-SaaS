// Экономика участия: какую цену ставить. Три сценария (оптимистичный, базовый, стрессовый), три цены (не ниже, безопасная, целевая) и таблица снижения цены.
// Считает код, без ИИ. Налог, обеспечение исполнения и антидемпинг берутся из price-floor.ts — той же логики, что на шаге «Цена» (читаем, не меняем); сверху ложатся то, чего там нет:
// проценты за деньги до оплаты, гарантийный резерв, рост затрат и неустойка (lib/risk-estimate.ts) — они пропорциональны цене, поэтому пересчитываются на каждую пробную цену.
// Допущения сценариев видны и меняются (Assumptions, EconSettings). Без затрат участника расчёта нет: своих цифр у программы нет.

import { priceFloor, type PriceCalc } from "@/lib/price-floor";
import type { EstimateResult } from "@/lib/risk-estimate";

export type EconSettings = {
  /** Целевая маржа, % цены: от неё считается целевая цена. */
  targetMarginPct: number;
  /** Оптимистичный сценарий: затраты ниже на столько процентов. */
  optimisticPct: number;
  /** Стрессовый сценарий: затраты выше на столько процентов (если договор не индексирует цену). */
  growthPct: number;
};

export const DEFAULT_ECON: EconSettings = { targetMarginPct: 10, optimisticPct: 5, growthPct: 10 };

/** Настройки сценариев из допущений расчёта (lib/risk-estimate.ts): рост затрат один и тот же в оценке рисков и в стрессовом сценарии. */
export const econSettings = (a: { targetMarginPct: number; optimisticPct: number; growthPct: number }): EconSettings => ({
  targetMarginPct: a.targetMarginPct,
  optimisticPct: a.optimisticPct,
  growthPct: a.growthPct,
});

export type Scenario = "optimistic" | "base" | "stress";

export type EconInput = {
  /** Расчёт цены из закупки и шага «Цена» (price-floor.ts); затраты участника — в нём. */
  calc: PriceCalc;
  estimate: EstimateResult;
  settings: EconSettings;
  /** Цена заявки или, пока её нет, начальная — для таблицы сценариев. */
  price: number | null;
};

export type ScenarioResult = {
  profit: number;
  /** Прибыль к цене, %. */
  margin: number;
  /** Что вошло: налог, обеспечение, проценты за деньги, гарантийный ремонт, рост затрат, неустойка — в рублях. */
  lines: { label: string; amount: number }[];
};

export type EconResult =
  | { ready: false; reason: "costs" | "nmck" }
  | {
      ready: true;
      nmck: number;
      price: number;
      scenarios: Record<Scenario, ScenarioResult>;
      /** Цены: ниже min базовый сценарий в убытке; ниже safe в убытке стрессовый; target — целевая маржа в базовом. null — не достижимо (убыток даже по начальной цене). */
      min: number | null;
      safe: number | null;
      target: number | null;
      /** Снижение цены от начальной, % → цена и прибыль в базовом и стрессовом сценарии. */
      table: { drop: number; price: number; base: number; stress: number }[];
      /** В стрессе берётся неустойка, наибольшая из найденных в договоре. */
      penaltyUsed: string | null;
      growthApplied: boolean;
    };

const FLOOR_LIMIT = 0.2; // ниже пятой части начальной цены не считаем
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export function economics({ calc, estimate, settings, price }: EconInput): EconResult {
  const nmck = calc.nmck;
  if (!nmck || nmck <= 0) return { ready: false, reason: "nmck" };
  if (!calc.costs || calc.costs <= 0) return { ready: false, reason: "costs" };

  const base = estimate.priceUsed && estimate.priceUsed > 0 ? estimate.priceUsed : nmck;
  const item = (id: string) => estimate.items.find((i) => i.id === id && i.amount !== null);
  const penalties = estimate.items.filter((i) => i.id.startsWith("penalty") && i.amount !== null).sort((a, b) => b.amount! - a.amount!);
  const worst = penalties[0] ?? null;
  const growthApplied = !estimate.indexed;

  // Суммы из оценки рисков пропорциональны цене, от которой они считались: на пробной цене P они в P / base раз.
  const scaled = (id: string, p: number) => ((item(id)?.amount ?? 0) * p) / base;

  const at = (p: number, scenario: Scenario): ScenarioResult | null => {
    const factor = scenario === "optimistic" ? 1 - settings.optimisticPct / 100 : scenario === "stress" && growthApplied ? 1 + settings.growthPct / 100 : 1;
    const costs = calc.costs! * factor;
    const b = priceFloor({ ...calc, costs }).at(p);
    if (!b) return null;
    // Если участник ввёл ставку и срок обеспечения на шаге «Цена», стоимость обеспечения уже в расчёте; иначе — допущение из оценки рисков.
    const guarantee = b.securityCost > 0 ? 0 : scaled("guarantee", p);
    const finance = scaled("finance", p);
    const warranty = scaled("warranty", p) * (scenario === "optimistic" ? 0 : scenario === "stress" ? 2 : 1);
    const penalty = scenario === "stress" && worst ? (worst.amount! * p) / base : 0;
    const profit = b.profit - guarantee - finance - warranty - penalty;
    const lines = [
      { label: "Затраты на исполнение", amount: costs },
      ...(b.extra > 0 ? [{ label: "Расходы на участие", amount: b.extra }] : []),
      ...(b.tax > 0 ? [{ label: "Налог с выручки", amount: b.tax }] : []),
      ...(b.securityCost + guarantee > 0 ? [{ label: "Обеспечение исполнения", amount: b.securityCost + guarantee }] : []),
      ...(finance > 0 ? [{ label: "Проценты за деньги до оплаты", amount: finance }] : []),
      ...(warranty > 0 ? [{ label: "Гарантийный ремонт", amount: warranty }] : []),
      ...(penalty > 0 ? [{ label: "Неустойка (один случай)", amount: penalty }] : []),
    ].map((l) => ({ ...l, amount: round2(l.amount) }));
    return { profit: round2(profit), margin: (profit / p) * 100, lines };
  };

  // Самая низкая цена от начальной вниз, при которой условие ещё выполняется подряд; null — не выполняется даже по начальной цене.
  const lowest = (ok: (p: number) => boolean): number | null => {
    if (!ok(nmck)) return null;
    const step = nmck / 1000;
    let up = nmck;
    while (up - step >= nmck * FLOOR_LIMIT && ok(up - step)) up -= step;
    if (up - step < nmck * FLOOR_LIMIT) return Math.ceil(nmck * FLOOR_LIMIT * 100) / 100;
    let lo = up - step;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + up) / 2;
      if (ok(mid)) up = mid;
      else lo = mid;
    }
    return Math.ceil(up * 100 - 1e-6) / 100;
  };
  const positive = (scenario: Scenario) => (p: number) => (at(p, scenario)?.profit ?? -1) >= 0;
  const target = settings.targetMarginPct;

  const p = price && price > 0 ? price : nmck;
  const scenarios = { optimistic: at(p, "optimistic"), base: at(p, "base"), stress: at(p, "stress") };
  if (!scenarios.optimistic || !scenarios.base || !scenarios.stress) return { ready: false, reason: "costs" };

  const table = [0, 5, 10, 15, 20, 25, 30].map((drop) => {
    const price = round2(nmck * (1 - drop / 100));
    return { drop, price, base: at(price, "base")?.profit ?? 0, stress: at(price, "stress")?.profit ?? 0 };
  });

  return {
    ready: true,
    nmck,
    price: p,
    scenarios: scenarios as Record<Scenario, ScenarioResult>,
    min: lowest(positive("base")),
    safe: lowest(positive("stress")),
    target: lowest((q) => {
      const r = at(q, "base");
      return r !== null && r.margin >= target && r.profit >= 0;
    }),
    table,
    penaltyUsed: worst ? worst.title : null,
    growthApplied,
  };
}
