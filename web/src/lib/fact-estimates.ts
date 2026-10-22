// Суммы по фактам для «Сколько это может стоить»: доставка (расстояние из документов и профиля, тариф вводит участник) и курс валюты (курсы ЦБ, сумма в валюте вводит участник).
// Каждая строка называет, на чём стоит: «центры регионов, прямая × 1,3» или «курсы ЦБ за год». Нет данных — «не определено» и что вписать, а не число. Метка в экране — «Оценка».

import type { DeliveryResult } from "@/lib/delivery-cost";
import { FX_CURRENCIES, type FxResult } from "@/lib/fx-risk";
import type { FactItem } from "@/lib/risk-estimate";

const ru = (n: number, digits = 2) => n.toLocaleString("ru-RU", { maximumFractionDigits: digits }).replace(/[  ]/g, " ");
const pct1 = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateRu = (iso: string) => iso.split("-").reverse().join(".");

/** Строка доставки. Нет двух регионов (место поставки или ваш адрес не определены) — пусто: остаётся общая строка «сумма не определена». */
export function deliveryItems(d: DeliveryResult): FactItem[] {
  const leg = d.leg;
  if (!leg) return [];
  const route = `${leg.from.center} → ${leg.to.center}`;
  const basis = `Расстояние: центры регионов (${route}), ${ru(leg.straight, 0)} км по прямой × ${ru(leg.factor)}. Тариф — ваш`;
  if (leg.road === null) {
    return [{ id: "logistics", title: `Доставка: ${route}`, scenario: leg.note ?? "", amount: null, basis: `Центры регионов: ${route}`, kind: "unknown", inTotal: false, ask: "Запросите маршрут и тариф у перевозчика: по прямой это не посчитать" }];
  }
  if (d.cost === null) {
    return [
      {
        id: "logistics",
        title: `Доставка: ${route}, ≈ ${ru(leg.road, 0)} км`,
        scenario: `${ru(leg.straight, 0)} км по прямой × ${ru(leg.factor)} ≈ ${ru(leg.road, 0)} км дороги`,
        amount: null,
        basis: `Центры регионов: ${route}`,
        kind: "unknown",
        inTotal: false,
        ask: `Впишите: ${d.missing.join(", ")}`,
      },
    ];
  }
  if (d.extra !== null) {
    return [
      {
        id: "logistics",
        title: `Доставка дороже обычной: ${route}`,
        scenario: `${d.formula}, минус обычная доставка на ${ru(d.usualKm!, 0)} км`,
        amount: d.extra,
        basis,
        kind: "estimate",
        inTotal: true,
      },
    ];
  }
  return [{ id: "logistics", title: `Доставка до места поставки: ${route}`, scenario: d.formula ?? "", amount: d.cost, basis, kind: "estimate", inTotal: false }];
}

/** Строка курса: сколько рубли добавит рост курса, который бывал за последний год на таком же сроке. */
export function fxItems(f: FxResult): FactItem[] {
  if (!f.last) return [];
  const cur = FX_CURRENCIES[f.code];
  if (f.extra === null || !f.rise || !f.windowDays) {
    return [
      {
        id: "fx",
        title: `Курс: ${cur.name}`,
        scenario: `Курс ЦБ на ${dateRu(f.last.date)}: ${ru(f.last.rate, 4)} ₽`,
        amount: null,
        basis: "Курсы Банка России",
        kind: "unknown",
        inTotal: false,
        ask: `Впишите: ${f.missing.join(", ")}`,
      },
    ];
  }
  const { rise } = f;
  return [
    {
      id: "fx",
      title: `Курс: ${cur.name}, закупка ${ru(f.amount!, 0)} ${cur.sign}`,
      scenario: `За год за ${ru(f.windowDays, 0)} дн. курс вырастал до +${pct1(rise.pct)} % (с ${dateRu(rise.from.date)} по ${dateRu(rise.to.date)}); закупка по курсу ${ru(f.last.rate, 4)} ₽ на ${dateRu(f.last.date)} — ${ru(f.exposure!)} ₽`,
      amount: f.extra,
      basis: "Курсы Банка России за год; прошлый рост не гарантирует будущий",
      kind: "estimate",
      inTotal: true,
    },
  ];
}
