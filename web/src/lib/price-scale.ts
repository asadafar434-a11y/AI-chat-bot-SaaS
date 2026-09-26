// Шкала цены на экране «До какой цены снижаться»: от начальной цены вниз, где убыток, где прибыль,
// докуда обеспечение повышенное. Здесь только геометрия — положения в процентах ширины, без разметки.
// Масштаб зависит только от расчёта, не от вашей цены: иначе шкала сдвигалась бы под пальцем, пока тянете ползунок.
// Цена ниже края шкалы прижимается к краю, точное снижение — в подписи под полем цены.
import type { Floor } from "./price-floor";

export type ScaleTick = { x: number; label: string };

export type ScaleModel = {
  lo: number;
  hi: number;
  // Шаг ползунка в рублях: около 1/500 начальной цены, круглый.
  step: number;
  // Положение цены на шкале, 0–100. Цена за краями прижимается к краю.
  x: (price: number) => number;
  // Цена в точке шкалы, по шагу ползунка.
  priceAt: (x: number) => number;
  // none — убытка на шкале нет, part — слева от floorX, all — по любой цене до начальной, unknown — не посчитано.
  loss: "none" | "part" | "all" | "unknown";
  floorX: number | null;
  // Докуда обеспечение повышенное: снижение на 25 % и больше.
  raisedX: number | null;
  ticks: ScaleTick[];
};

// Запас слева от самой низкой отметки, в долях начальной цены.
const MARGIN = 0.04;

export function scaleModel(nmck: number, floor: Floor, raisedBelow: number | null): ScaleModel {
  const marks = [floor.ok ? floor.price : null, raisedBelow].filter((v): v is number => v !== null && v > 0 && v < nmck);
  const lowest = Math.min(nmck, ...marks);
  // Снижение, до которого видна шкала, — кратно 10 %, от 30 до 90 %: нижняя цена и граница антидемпинга с запасом.
  const dropMax = Math.min(0.9, Math.max(0.3, Math.ceil((1 - lowest / nmck + MARGIN) * 10 - 1e-9) / 10));
  const step = 10 ** Math.max(0, Math.floor(Math.log10(nmck / 500)));
  const lo = Math.floor((nmck * (1 - dropMax)) / step) * step;
  const hi = nmck;
  const x = (p: number) => ((Math.min(Math.max(p, lo), hi) - lo) / (hi - lo)) * 100;
  const priceAt = (pos: number) => {
    const raw = (Math.min(Math.max(pos, 0), 100) / 100) * (hi - lo);
    return Math.min(hi, lo + Math.round(raw / step) * step);
  };

  let loss: ScaleModel["loss"] = "unknown";
  if (floor.ok) loss = floor.aboveNmck ? "all" : floor.price <= lo ? "none" : "part";

  const every = dropMax > 0.6 ? 0.2 : 0.1;
  const ticks: ScaleTick[] = [];
  for (let i = Math.floor(dropMax / every + 1e-9); i >= 0; i--) {
    const drop = Math.round(i * every * 10) / 10;
    ticks.push({ x: x(nmck * (1 - drop)), label: drop === 0 ? "начальная" : `−${Math.round(drop * 100)}\u00a0%` });
  }

  return {
    lo,
    hi,
    step,
    x,
    priceAt,
    loss,
    floorX: loss === "part" && floor.ok ? x(floor.price) : null,
    raisedX: raisedBelow !== null && raisedBelow > lo ? x(raisedBelow) : null,
    ticks,
  };
}
