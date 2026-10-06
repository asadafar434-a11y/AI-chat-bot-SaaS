// Строки бланка заказчика заполняются реквизитами участника по названию — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fillBlank } from "./blank-fill.ts";
import { EMPTY_PROFILE } from "./profile.ts";

const profile = {
  ...EMPTY_PROFILE,
  fullName: "ООО «Праздник»",
  inn: "6612345676",
  kpp: "661201001",
  legalAddress: "г. Екатеринбург, ул. Ленина, 1",
  bankName: "Банк «Пример»",
  account: "40702810000000000001",
  bik: "046577674",
  head: "Директор Иванов И. И.",
};

const blank = (title: string, labels: string[]) => ({ source: "Приложение", title, pages: "стр. 1", fields: labels.map((label) => ({ label, value: "" })) });
const values = (df: { fields: { value: string }[] }) => df.fields.map((f) => f.value);

test("реквизиты участника — в строки бланка по названию", () => {
  const out = fillBlank(
    blank("Анкета участника закупки", ["Наименование участника", "ИНН", "КПП", "Место нахождения", "Наименование банка", "Расчётный счёт", "БИК", "Руководитель (должность, ФИО)"]),
    profile,
  );
  assert.deepEqual(values(out), [
    "ООО «Праздник»",
    "6612345676",
    "661201001",
    "г. Екатеринбург, ул. Ленина, 1",
    "Банк «Пример»",
    "40702810000000000001",
    "046577674",
    "Директор Иванов И. И.",
  ]);
});

test("чужой ИНН и наименование товара не заполняем", () => {
  const out = fillBlank(blank("Сведения о соисполнителях", ["ИНН (при наличии) учредителей участника закупки", "Наименование товара"]), profile);
  assert.deepEqual(values(out), ["", ""]);
});

test("техническое предложение анонимное — реквизиты в него не попадают", () => {
  assert.deepEqual(values(fillBlank(blank("Техническое предложение", ["Наименование участника"]), profile)), [""]);
  assert.deepEqual(values(fillBlank(blank("ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ", ["Наименование участника"]), profile)), [""]);
});

test("без профиля бланк остаётся как был", () => {
  assert.deepEqual(values(fillBlank(blank("Анкета участника закупки", ["ИНН"]), null)), [""]);
});
