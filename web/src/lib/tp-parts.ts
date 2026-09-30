import type { Criteria } from "@/lib/criteria";
import { participantFromPlatform } from "@/lib/law-kind";
import type { TpForm } from "@/lib/tp";

// Части заявки собираются отдельными файлами: техническое предложение подают в первую часть,
// и в нём не должно быть ничего, что раскрывает участника, — ни названия, ни ИНН, ни подписи.
// Названия и состав частей нужны и странице ТП в браузере, поэтому они здесь, а не рядом со сборкой Word (tp-docx.ts):
// оттуда в браузер ушла бы вся библиотека docx.
export type TpPart = "tp" | "participant" | "declaration" | "price" | "experience" | "staff";

export const PART_TITLES: Record<TpPart, string> = {
  tp: "Техническое предложение",
  participant: "Анкета участника закупки",
  declaration: "Декларация о принадлежности к субъектам малого и среднего предпринимательства",
  price: "Предложение о цене договора",
  experience: "Сведения об опыте участника закупки",
  staff: "Сведения о специалистах и иных работниках участника закупки",
};

// За что по порядку оценки дают баллы: опыт — исполненными договорами, специалисты — сотрудниками с квалификацией.
const EVIDENCE_RULES: [Exclude<TpPart, "tp" | "participant" | "declaration" | "price">, RegExp][] = [
  ["experience", /опыт/i],
  ["staff", /специалист|работник|трудов\S* ресурс|кадр|персонал/i],
];

// Строки порядка оценки, по которым собирается часть: «Опыт» — строки про опыт, «Трудовые ресурсы» — про специалистов.
export function criteriaRowsFor(criteria: Criteria | undefined, part: "experience" | "staff") {
  if (!criteria || criteria.howWins !== "points") return [];
  const re = EVIDENCE_RULES.find(([key]) => key === part)![1];
  return criteria.rows.filter((row) => re.test(`${row.indicator} ${row.detail}`));
}

// Техническое предложение нужно всегда. Анкета — кроме 44-ФЗ: там сведения об участнике передаёт площадка
// (решение владельца 30.09.2026, п. 2 ч. 6 ст. 43 44-ФЗ); kind — закон и способ закупки. Декларация и цена — если их
// требует форма заказчика; сведения об опыте и о специалистах — если за них дают баллы по порядку оценки.
export const partsOf = (form: TpForm, criteria?: Criteria, kind?: string): TpPart[] => [
  "tp",
  ...(participantFromPlatform(kind) ? [] : (["participant"] as const)),
  ...(form.smeDeclaration ? (["declaration"] as const) : []),
  ...(form.hasPrice ? (["price"] as const) : []),
  ...EVIDENCE_RULES.filter(([part]) => criteriaRowsFor(criteria, part).length > 0).map(([part]) => part),
];
