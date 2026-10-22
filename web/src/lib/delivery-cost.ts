// Доставка в другой регион в рублях: расстояние берётся из документов (место поставки) и профиля (ваш адрес), тариф перевозчика или расход топлива вводит участник. Формулы видны, числа тарифов
// не выдумываются: нет тарифа — «впишите тариф», а не сумма. Расстояние — по прямой между центрами регионов × коэффициент (lib/geo.ts), это оценка, не маршрут.
// «Обычное расстояние» — сколько вы обычно возите: разница с ним показывает, на сколько эта закупка дороже в перевозке. Модуль без браузера и сервера.

import { DEFAULT_ROAD_FACTOR, legBetween, type Leg } from "@/lib/geo";

export type DeliveryMode = "carrier" | "own";

/** Ввод участника (всё строками, как в полях): перевозчик — тариф за километр пробега; своя машина — расход на 100 км и цена литра. */
export type DeliveryInputs = {
  mode: DeliveryMode;
  /** Тариф перевозчика, ₽ за км пробега. */
  rate: string;
  trips: string;
  /** Машина возвращается порожней: считать пробег туда и обратно. */
  roundTrip: boolean;
  /** Своя машина: расход топлива, л на 100 км. */
  consumption: string;
  /** Своя машина: цена литра топлива, ₽. */
  fuel: string;
  /** Коэффициент «дорога длиннее прямой»; пусто — 1,3. */
  factor: string;
  /** Как далеко вы обычно возите, км в одну сторону. Пусто — сравнения нет. */
  usualKm: string;
};

export const EMPTY_DELIVERY: DeliveryInputs = { mode: "carrier", rate: "", trips: "1", roundTrip: true, consumption: "", fuel: "", factor: "", usualKm: "" };

const str = (x: unknown, max = 24) => (typeof x === "string" ? x.slice(0, max) : "");

export function normalizeDelivery(raw: unknown): DeliveryInputs {
  const x = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    mode: x.mode === "own" ? "own" : "carrier",
    rate: str(x.rate),
    trips: typeof x.trips === "string" ? str(x.trips) : EMPTY_DELIVERY.trips,
    roundTrip: typeof x.roundTrip === "boolean" ? x.roundTrip : true,
    consumption: str(x.consumption),
    fuel: str(x.fuel),
    factor: str(x.factor),
    usualKm: str(x.usualKm),
  };
}

const positive = (s: string): number | null => {
  const n = Number(s.replace(/[\s ]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export type DeliveryResult = {
  leg: Leg | null;
  /** Километров дороги в одну сторону, которые взяты в расчёт. */
  km: number | null;
  /** Стоимость всех рейсов до места поставки. */
  cost: number | null;
  /** Обычное расстояние, км в одну сторону, если участник его вписал. */
  usualKm: number | null;
  /** Стоимость тех же рейсов на обычное расстояние. */
  usualCost: number | null;
  /** На сколько дороже обычного: cost − usualCost (не меньше нуля). */
  extra: number | null;
  /** Во сколько раз дальше обычного. */
  times: number | null;
  /** Что вписать, чтобы получилась сумма. */
  missing: string[];
  /** Формула словами: из чего получилась сумма. */
  formula: string | null;
};

const ru = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ");

function perKm(input: DeliveryInputs): { value: number | null; missing: string[]; label: string } {
  if (input.mode === "own") {
    const l = positive(input.consumption);
    const f = positive(input.fuel);
    const missing = [...(l ? [] : ["расход топлива, л на 100 км"]), ...(f ? [] : ["цену литра"])];
    return { value: l && f ? (l / 100) * f : null, missing, label: l && f ? `${ru(l)} л/100 км × ${ru(f)} ₽` : "" };
  }
  const r = positive(input.rate);
  return { value: r, missing: r ? [] : ["тариф перевозчика, ₽ за км"], label: r ? `${ru(r)} ₽/км` : "" };
}

export function deliveryCost(fromRegion: string | null, toRegion: string | null, input: DeliveryInputs): DeliveryResult {
  const factor = positive(input.factor) ?? DEFAULT_ROAD_FACTOR;
  const leg = fromRegion && toRegion ? legBetween(fromRegion, toRegion, factor) : null;
  const km = leg?.road ?? null;
  const rate = perKm(input);
  const trips = positive(input.trips);
  const missing = [...rate.missing, ...(trips ? [] : ["число рейсов"])];
  if (!leg || km === null) return { leg, km, usualKm: null, cost: null, usualCost: null, extra: null, times: null, missing, formula: null };
  const legs = input.roundTrip ? 2 : 1;
  const money = (oneWayKm: number) => (rate.value !== null && trips !== null ? round2(oneWayKm * legs * rate.value * trips) : null);
  const cost = money(km);
  const usual = positive(input.usualKm);
  const usualCost = usual ? money(usual) : null;
  const extra = cost !== null && usualCost !== null ? Math.max(0, round2(cost - usualCost)) : null;
  const formula =
    cost === null ? null : `${ru(km)} км${input.roundTrip ? " × 2 (туда и обратно)" : ""} × ${rate.label}${input.mode === "own" ? " (только топливо)" : ""} × ${ru(trips!)} рейс.`;
  return { leg, km, usualKm: usual, cost, usualCost, extra, times: usual ? Math.round((km / usual) * 10) / 10 : null, missing, formula };
}
