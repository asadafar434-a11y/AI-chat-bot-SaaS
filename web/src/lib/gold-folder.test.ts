// Эталон: формы заказчика из заявок трёх заказчиков (папка «Татьяна-Примеры документов») — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Criteria } from "./criteria.ts";
import { blankReplaces, criteriaRowsFor } from "./tp-parts.ts";

// Название формы заказчика, как в его документе, и наш документ, который она заменяет.
const REPLACES: [string, Parameters<typeof blankReplaces>[0]][] = [
  ["Сведения об участнике", "participant"],
  ["Справка об опыте оказания услуг за период 2025-2023 гг.", "experience"],
  ["Анкета Исполнителя", "participant"],
  ["ЦЕНОВОЕ ПРЕДЛОЖЕНИЕ", "price"],
  // Конкурс МСП «Форумная дирекция»: формы 2 и 3 рекомендуемые, но заказчик их приложил — делаем по ним.
  ["Анкета участника закупки", "participant"],
  ["СВЕДЕНИЯ ОБ ОПЫТЕ УЧАСТНИКА КОНКУРСА ПО ОКАЗАНИЮ УСЛУГИ, связанного с предметом ДОГОВОРА", "experience"],
];

for (const [title, part] of REPLACES) {
  test(`«${title}» заменяет наш документ: ${part}`, () => {
    assert.ok(blankReplaces(part, [{ title }]));
  });
}

test("согласие на обработку персональных данных не заменяет наш документ о специалистах", () => {
  assert.ok(!blankReplaces("staff", [{ title: "Согласие на обработку персональных данных" }]));
});

test("«Предложение» с итоговой стоимостью заменяет наш документ о цене", { todo: "правило смотрит на поля формы, не только на название" }, () => {
  assert.ok(blankReplaces("price", [{ title: "Предложение" }]));
});

test("технико-коммерческое предложение заменяет наше техническое предложение", { todo: "ТП по форме заказчика — после решения" }, () => {
  assert.ok(blankReplaces("tp", [{ title: "ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ" }]));
});

// Конкурс МСП «Форумная дирекция» (223-ФЗ): первая часть заявки — только согласие по форме 1, сведения об участнике и цена туда не попадают.
test("«Часть № 1 заявки» — форма техпредложения, а не замена анкеты, декларации, цены, опыта или специалистов", () => {
  const forms = [{ title: "Часть № 1 заявки на участие в конкурсе в электронной форме" }];
  for (const part of ["participant", "declaration", "price", "experience", "staff"] as const) {
    assert.ok(!blankReplaces(part, forms), part);
  }
});

test("единственный показатель квалификации — «опыт работы, связанный с предметом договора»: собирается документ «Сведения об опыте»", () => {
  const row = {
    criterion: "Квалификация участников закупки",
    criterionWeight: "60 %",
    indicator: "Применяемый показатель критерия: опыт работы, связанный с предметом договора (С1)",
    indicatorWeight: "100 %",
    detail: "",
    detailWeight: "",
    scoring: "С1 = КЗ x 100 x (Кi / Кmax), КЗ = 1,0",
    proof: "копия исполненного договора, акты приёмки, документы об уплате неустоек",
    form: "Форма № 3",
    source: "Приложение № 3 к информационной карте, п. 2.1",
    quote: "Оценивается общее количество исполненных участником закупки договоров",
    verified: true,
  };
  const criteria: Criteria = { howWins: "points", rows: [row] };
  assert.equal(criteriaRowsFor(criteria, "experience").length, 1);
  assert.equal(criteriaRowsFor(criteria, "staff").length, 0);
});
