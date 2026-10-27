// Себестоимость исполнения по составу, который велит заказчик: зарплата персонала с взносами, аренда техники, за месяц, за весь срок и за единицу объёма.
// Цифры — только найденные в интернете и проверенные кодом (lib/rate-extract.ts) и числа заказчика (сколько людей, сколько техники, срок, объём); чего не нашли, того в сумме нет и это названо.
// Это оценка по рынку, не смета: накладные расходы, прибыль, обучение, форма, расходные материалы и непредвиденное сюда не входят (так и сказано на экране).

import type { RateKind, RateObservation } from "@/lib/rate-extract";
import type { SavedRates } from "@/lib/rate-cache";
import type { ResourceNeed } from "@/lib/resource-need";

/** Страховые взносы работодателя: 30 % общий тариф и 0,2 % от несчастных случаев (самая низкая ставка); допущение, участник знает свою (для малого бизнеса она бывает ниже). */
export const CONTRIBUTIONS_PCT = 30.2;

export type CrewLine = {
  key: string;
  kind: RateKind;
  name: string;
  count: number;
  /** Ставка за месяц на одного человека или одну единицу техники; null — не нашли. */
  monthly: number | null;
  /** Из каких цифр: по региону закупки, по другим регионам или не найдено. */
  basis: "region" | "other" | "none";
  sources: RateObservation[];
  /** monthly × count. */
  total: number | null;
};

export type CrewCost = {
  staff: CrewLine[];
  equipment: CrewLine[];
  months: number | null;
  contributionsPct: number;
  /** Найдено позиций / всего. */
  covered: { staff: [number, number]; equipment: [number, number] };
  /** Нашли ставку по каждой позиции. */
  complete: boolean;
  staffMonth: number;
  contributionsMonth: number;
  equipmentMonth: number;
  monthTotal: number;
  termTotal: number | null;
  /** За единицу объёма (тонна, м², час…), если объём известен. */
  perUnit: number | null;
};

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
};

function lineOf(kind: RateKind, key: string, name: string, count: number, saved: SavedRates | null | undefined): CrewLine {
  const found = saved?.results.find((r) => r.key === key)?.observations ?? [];
  // Цифры по региону закупки важнее; нет их — берём остальные (регион не назван или другой), и это видно в основе.
  const same = found.filter((o) => o.regionMatch === "same");
  const pool = same.length > 0 ? same : found;
  if (pool.length === 0) return { key, kind, name, count, monthly: null, basis: "none", sources: [], total: null };
  const monthly = median(pool.map((o) => o.monthly));
  return { key, kind, name, count, monthly, basis: same.length > 0 ? "region" : "other", sources: pool, total: monthly * count };
}

export function crewCost(input: { need: ResourceNeed; saved: SavedRates | null | undefined; volumeTotal?: number | null; months?: number | null; contributionsPct?: number }): CrewCost {
  const contributionsPct = input.contributionsPct ?? CONTRIBUTIONS_PCT;
  const staff = input.need.staff.map((s) => lineOf("salary", `s:${s.role}`, s.role, s.count, input.saved));
  const equipment = input.need.equipment.map((e) => lineOf("rent", `e:${e.name}`, e.name, e.count, input.saved));
  const sum = (lines: CrewLine[]) => lines.reduce((s, l) => s + (l.total ?? 0), 0);
  const staffMonth = sum(staff);
  const contributionsMonth = Math.round((staffMonth * contributionsPct) / 100);
  const equipmentMonth = sum(equipment);
  const monthTotal = staffMonth + contributionsMonth + equipmentMonth;
  const months = input.months ?? input.need.months;
  const termTotal = months && monthTotal > 0 ? monthTotal * months : null;
  const found = (lines: CrewLine[]): [number, number] => [lines.filter((l) => l.monthly !== null).length, lines.length];
  const covered = { staff: found(staff), equipment: found(equipment) };
  return {
    staff,
    equipment,
    months: months ?? null,
    contributionsPct,
    covered,
    complete: covered.staff[0] === covered.staff[1] && covered.equipment[0] === covered.equipment[1] && monthTotal > 0,
    staffMonth,
    contributionsMonth,
    equipmentMonth,
    monthTotal,
    termTotal,
    perUnit: termTotal !== null && input.volumeTotal && input.volumeTotal > 0 ? termTotal / input.volumeTotal : null,
  };
}
