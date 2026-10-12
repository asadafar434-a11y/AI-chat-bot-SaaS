// Нормализация названий, моделей, ТУ/ГОСТ, ОКПД2 и чисел с единицами — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compact,
  differentOrg,
  isInn,
  isOkpd2,
  measuresIn,
  modelTokens,
  nameTerms,
  okpd2In,
  okpd2Relation,
  orgWords,
  sameOrg,
  standardRefs,
  termOverlap,
} from "./registry-text.ts";

test("обозначения сравниваются без пробелов, знаков и разницы между латиницей и кириллицей", () => {
  assert.equal(compact("КТО 05/Х"), compact("кто-05 х"));
  assert.equal(compact("AB-12"), compact("АВ12"), "латинские A и B похожи на кириллические");
  assert.notEqual(compact("КТО 05"), compact("КТО 01"));
});

test("слова названия: падежи сводятся к одной основе, служебные слова и числа отбрасываются", () => {
  assert.equal(nameTerms("Кресло для руководителя 3 шт").length, 2, "«для», «шт» и число отброшены");
  assert.deepEqual(nameTerms("Кресла"), nameTerms("кресло"));
  assert.deepEqual(nameTerms("кресел"), nameTerms("кресло"));
  assert.deepEqual(nameTerms("и на по 12"), []);
});

test("ТУ и ГОСТ вынимаются из названия и сравниваются в сжатом виде", () => {
  const refs = standardRefs("Пневмомодуль ПМ (PN 0,05...1,0 МПа) ТУ 3742-002-24039780-2003, ГОСТ 16371-2014");
  assert.equal(refs.length, 2);
  assert.ok(refs.includes(compact("ТУ3742-002-24039780-2003")));
  assert.ok(refs.includes(compact("ГОСТ16371-2014")));
  assert.equal(standardRefs("Стол письменный").length, 0);
});

test("модель: буквы вместе с цифрами и заглавные сокращения; ТУ, размеры и обычные слова моделью не считаются", () => {
  assert.deepEqual(modelTokens("Прибор оконечный объектовый ПБСО-СМ"), [compact("ПБСО-СМ")]);
  assert.ok(modelTokens("Контейнер тормозного оборудования КТО 05/Х ТУ 30.20.40-027-53711114-2012").includes(compact("05/Х")));
  assert.ok(modelTokens("Грунтовка ГФ-021").includes(compact("ГФ-021")));
  assert.equal(modelTokens("Ресивер для сжатого воздуха объемом 80 л").length, 0, "«80 л» — размер, а не модель");
  assert.equal(modelTokens("Пневмомодуль ТУ 3742-002-24039780-2003").length, 0, "номер ТУ — не модель");
});

test("организации: форма не мешает совпадению, разные организации отличаются", () => {
  assert.ok(sameOrg('ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "КАСКАД"', 'ООО «Каскад»'));
  assert.ok(sameOrg('АКЦИОНЕРНОЕ ОБЩЕСТВО "ЭЛЕКТРОКАБЕЛЬ" КОЛЬЧУГИНСКИЙ ЗАВОД', 'АО "Кольчугинский завод Электрокабель"'));
  assert.ok(!sameOrg('ООО "Каскад"', 'ООО "Каскад-Плюс"'));
  assert.ok(differentOrg('ООО "Каскад"', 'АО "Электрокабель"'));
  assert.ok(!differentOrg('ООО "Каскад"', 'ООО "Каскад-Плюс"'), "общее слово — организации не считаем явно разными");
  assert.deepEqual(orgWords("ООО"), []);
});

test("ИНН: десять цифр для организации, двенадцать для предпринимателя", () => {
  assert.ok(isInn("5835034400") && isInn("583503440012"));
  assert.ok(!isInn("58350344") && !isInn("58350344AB"));
});

test("ОКПД2: коды находятся в тексте, даты с годом — нет", () => {
  assert.deepEqual(okpd2In("Код ОКПД2: 31.01.12.160, также 26.30.50"), ["31.01.12.160", "26.30.50"]);
  assert.deepEqual(okpd2In("Дата подачи 12.10.2026 до 10:00"), []);
  assert.ok(isOkpd2("15.20.32.120") && isOkpd2("29.20.23") && isOkpd2("25.29") && !isOkpd2("15.20.32.1200") && !isOkpd2("abc"));
});

test("ОКПД2: код равен, вложен, шире, из той же группы или другого товара", () => {
  assert.equal(okpd2Relation("31.01.12.160", "31.01.12.160"), "equal");
  assert.equal(okpd2Relation("31.01.12.160", "31.01.12"), "inside");
  assert.equal(okpd2Relation("31.01.12", "31.01.12.160"), "contains");
  assert.equal(okpd2Relation("31.01.12.160", "31.01.11.150"), "same_class");
  assert.equal(okpd2Relation("31.01.12.160", "26.30.50"), "different");
  assert.equal(okpd2Relation("31.01.1", "31.01.12"), "contains", "31.01.1 — группа, в которую входит 31.01.12");
});

test("числа с единицами: единицы приводятся к одному виду, число без единицы не считается", () => {
  assert.deepEqual(measuresIn("Ресивер объемом 80 л, 220 В, 50 Гц"), [
    { value: 80, unit: "л" },
    { value: 220, unit: "в" },
    { value: 50, unit: "гц" },
  ]);
  assert.deepEqual(measuresIn("объём 1,5 литра"), [{ value: 1.5, unit: "л" }]);
  assert.deepEqual(measuresIn("5 мест, 12 штук"), [], "«5 мест» — не метры");
});

test("перекрытие слов: доля слов запроса, найденных в названии", () => {
  assert.equal(termOverlap(["крес", "руководите"], ["крес", "офис"]), 0.5);
  assert.equal(termOverlap([], ["кресл"]), 0);
});
