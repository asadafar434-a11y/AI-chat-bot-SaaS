// Калькулятор цены для конкретной закупки: что в нём стоит и как показывать суммы. Сам расчёт — в price-floor.ts.
import { defaultsFor, type PriceCalc } from "@/lib/price-floor";
import type { Purchase } from "@/lib/purchase";
import { formatRubles, parseRubles } from "@/lib/rub-words";
import { SAMPLE_PRICE_CALC } from "@/lib/sample-purchase";

// Найденное в закупке, в примере — вымышленные расходы, поверх — вписанное участником.
export const calcFor = (purchase: Purchase): PriceCalc => ({
  ...defaultsFor(purchase, parseRubles(purchase.price)),
  ...(purchase.sample ? SAMPLE_PRICE_CALC : {}),
  ...purchase.priceCalc,
});

export const rub = (value: number) => `${formatRubles(value).replace("-", "−")} ₽`;
// Без «,00» — для подписей на шкале и в сводке.
export const rubShort = (value: number) => rub(value).replace(",00 ₽", " ₽");
// Снижение — с округлением вниз: 24,99 % не должно выглядеть как 25 %, с которых начинается антидемпинг.
export const dropText = (drop: number) => (Math.floor(drop * 1000 + 1e-6) / 10).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
export const pctText = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
