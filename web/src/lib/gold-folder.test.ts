// Эталон: формы заказчика из заявок трёх заказчиков (папка «Татьяна-Примеры документов») — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { blankReplaces } from "./tp-parts.ts";

// Название формы заказчика, как в его документе, и наш документ, который она заменяет.
const REPLACES: [string, Parameters<typeof blankReplaces>[0]][] = [
  ["Сведения об участнике", "participant"],
  ["Справка об опыте оказания услуг за период 2025-2023 гг.", "experience"],
  ["Анкета Исполнителя", "participant"],
  ["ЦЕНОВОЕ ПРЕДЛОЖЕНИЕ", "price"],
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
