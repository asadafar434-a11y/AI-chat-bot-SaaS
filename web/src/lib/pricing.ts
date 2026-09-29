// Цены сервиса — решения владельца от 29.09.2026. Модуль без зависимостей: цены нужны экрану тарифов,
// оплате и лимитам ИИ, а проверяют их тесты без сборки (npm test).
// Заявка под ключ — 1000 ₽; пакеты заявок — со скидкой за объём: 5 заявок — минус 10 %, 10 — минус 20 %.
// Проверка пакета специалистом — 500 ₽. Пересчёты ИИ сверх трёх в заявке — пакетом: ещё 3 за 99 ₽.
export const PRICE_APP = 1000;
export const PRICE_EXPERT = 500;
export const RECHECK_PACK = { count: 3, price: 99 } as const;

export type Plan = {
  count: number;
  discountPct: number;
  price: number;
  // Цена одной заявки в пакете и экономия против покупки по одной, в рублях.
  perApp: number;
  saving: number;
};

const plan = (count: number, discountPct: number): Plan => {
  const price = Math.round(PRICE_APP * count * (1 - discountPct / 100));
  return { count, discountPct, price, perApp: Math.round(price / count), saving: PRICE_APP * count - price };
};

export const PLANS: Plan[] = [plan(1, 0), plan(5, 10), plan(10, 20)];
