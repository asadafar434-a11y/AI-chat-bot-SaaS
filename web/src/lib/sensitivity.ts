// Что будет с прибылью, если затраты вырастут: простой пересчёт на цифрах участника. Цену контракта и затраты вводит участник, статьи затрат — тоже; ничего не берётся «с рынка».
// Считает код. Статья — сумма её затрат в рублях и на сколько процентов она может вырасти («бензин +10 %»). Сумма статей не должна быть больше всех затрат — иначе один рубль посчитан дважды.

import { parseAmount } from "@/lib/indicative-price";
import type { SensitivityData } from "@/lib/hidden-costs";

export type SensitivityRow = { id: string; name: string; delta: number; margin: number; marginPct: number };

export type SensitivityResult = {
  /** Цена и затраты введены и цена больше нуля. */
  ready: boolean;
  margin: number | null;
  marginPct: number | null;
  /** На сколько процентов могут вырасти ВСЕ затраты, пока прибыль не станет нулевой. */
  reserve: number | null;
  rows: SensitivityRow[];
  total: { delta: number; margin: number; marginPct: number } | null;
  problems: string[];
};

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export function computeSensitivity(data: SensitivityData): SensitivityResult {
  const price = parseAmount(data.price);
  const cost = parseAmount(data.cost);
  const problems: string[] = [];
  if (price === null || price <= 0 || cost === null || cost <= 0) {
    return { ready: false, margin: null, marginPct: null, reserve: null, rows: [], total: null, problems };
  }
  const margin = price - cost;
  const marginPct = (margin / price) * 100;
  const reserve = margin > 0 ? (margin / cost) * 100 : 0;

  const rows: SensitivityRow[] = [];
  let sumAmounts = 0;
  for (const d of data.drivers) {
    const amount = parseAmount(d.amount);
    const shock = d.shock.trim() === "" ? null : Number(d.shock.replace(/[\s ]/g, "").replace(",", "."));
    if (amount === null || amount <= 0) continue;
    sumAmounts += amount;
    if (shock === null || !Number.isFinite(shock)) {
      problems.push(`«${d.name.trim() || "Статья"}»: укажите, на сколько процентов может вырасти.`);
      continue;
    }
    const delta = round2((amount * shock) / 100);
    rows.push({ id: d.id, name: d.name.trim() || "Без названия", delta, margin: round2(margin - delta), marginPct: ((margin - delta) / price) * 100 });
  }
  if (sumAmounts > cost + 0.005) problems.push("Статьи в сумме больше всех затрат: часть рублей посчитана дважды.");

  const delta = round2(rows.reduce((s, r) => s + r.delta, 0));
  const total = rows.length > 0 ? { delta, margin: round2(margin - delta), marginPct: ((margin - delta) / price) * 100 } : null;
  return { ready: true, margin: round2(margin), marginPct, reserve, rows, total, problems };
}
