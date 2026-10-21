// Какие запросы отправляются в поиск для проверки гипотез о скрытых затратах. Это ключевые слова по теме гипотезы, год и, если он есть в документах, регион места поставки (решение владельца 21.10.2026:
// в поиск не уходят ни тексты документов, ни название и реквизиты компании). Для гипотез, которые интернетом не проверить (кассовый разрыв, пени из договора), запроса нет — кнопки нет.

export type SearchContext = { year: number; /** Регион места поставки из документов, если нашёлся. */ place: string | null };

type Template = (c: SearchContext) => string;

const TEMPLATES: Record<string, Template> = {
  logistics: (c) => (c.place ? `тарифы на доставку грузов ${c.place} ${c.year}` : `тарифы на грузоперевозки по России ${c.year}`),
  fx: (c) => `официальный курс доллара евро ЦБ РФ ${c.year}`,
  materials: (c) => `рост цен на строительные материалы ${c.year}`,
  site: (c) => (c.place ? `стоимость проживания вахтовиков ${c.place} ${c.year}` : `стоимость проживания вахтовиков ${c.year}`),
  trips: (c) => (c.place ? `цена дизельного топлива бензина ${c.place} ${c.year}` : `цена дизельного топлива бензина ${c.year}`),
  payroll: (c) => `рост заработных плат ${c.year} Росстат`,
  licenses: (c) => `рост цен лицензии программное обеспечение облако импортозамещение ${c.year}`,
  products: (c) => `рост цен на продукты питания ${c.year} Росстат`,
};

/** Запрос для гипотезы или null, если интернетом её не проверить. */
export function queryFor(hypothesisId: string, context: SearchContext): string | null {
  return TEMPLATES[hypothesisId]?.(context) ?? null;
}

export const SEARCHABLE: string[] = Object.keys(TEMPLATES);
