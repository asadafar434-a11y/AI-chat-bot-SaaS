import type { TpForm } from "@/lib/tp";

// Части заявки собираются отдельными файлами: техническое предложение подают в первую часть,
// и в нём не должно быть ничего, что раскрывает участника, — ни названия, ни ИНН, ни подписи.
// Названия и состав частей нужны и странице ТП в браузере, поэтому они здесь, а не рядом со сборкой Word (tp-docx.ts):
// оттуда в браузер ушла бы вся библиотека docx.
export type TpPart = "tp" | "participant" | "declaration" | "price";

export const PART_TITLES: Record<TpPart, string> = {
  tp: "Техническое предложение",
  participant: "Анкета участника закупки",
  declaration: "Декларация о принадлежности к субъектам малого и среднего предпринимательства",
  price: "Предложение о цене договора",
};

// Техническое предложение и анкета нужны всегда; декларация и цена — если их требует форма заказчика.
export const partsOf = (form: TpForm): TpPart[] => [
  "tp",
  "participant",
  ...(form.smeDeclaration ? (["declaration"] as const) : []),
  ...(form.hasPrice ? (["price"] as const) : []),
];
