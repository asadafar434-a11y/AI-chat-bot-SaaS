// Загрузка закупки в «Аналитику» без ИИ: название, цена, закон, способ и заказчик находит код по тексту документов — npm test (без сети).
import assert from "node:assert/strict";
import { test } from "node:test";
import { findLaw, findMethod, findPrice, introOf, kindOf, purchaseForAnalytics } from "./analytics-intake.ts";
import { parseRubles } from "./rub-words.ts";

const NOTICE = {
  name: "Извещение.docx",
  text: [
    "ИЗВЕЩЕНИЕ О ПРОВЕДЕНИИ АУКЦИОНА В ЭЛЕКТРОННОЙ ФОРМЕ",
    "Закупка проводится в соответствии с Федеральным законом от 18.07.2011 № 223-ФЗ и Положением о закупке.",
    "Заказчик: Муниципальное унитарное предприятие «Тепло»",
    "Предмет договора: Поставка угля каменного марки ДПК для нужд котельных",
    "Начальная (максимальная) цена договора | 25 930 002,00",
    "Срок подачи заявок: до 30.10.2026",
  ].join("\n"),
};
const CONTRACT = {
  name: "Проект договора.docx",
  text: ["ДОГОВОР ПОСТАВКИ № ___", "1.1. Поставщик обязуется поставить уголь.", "2.1. Цена договора составляет 25 930 002,00 рублей. Начальная (максимальная) цена договора: 25 930 002,00 руб."].join("\n"),
};

test("цена: берётся из таблицы и из текста, чаще названное значение, пробелы и запятая разобраны; «рублей» не мешает", () => {
  const price = findPrice([NOTICE, CONTRACT]);
  assert.equal(price, "25 930 002 ₽".replace(" ₽", "") + " ₽", "целое число рублей без «,00»");
  assert.equal(parseRubles(price), 25_930_002, "аналитика читает эту строку как число");
  assert.equal(findPrice([{ name: "a", text: "НМЦК: 1 234 567,89 руб." }]), "1 234 567,89 ₽");
  assert.equal(findPrice([{ name: "a", text: "Начальная (максимальная) цена контракта, руб.: 685000.50" }]), "685 000,50 ₽");
});

test("цена: нет подписи или число меньше тысячи (номер пункта, процент) — пусто, ничего не выдумывается; два разных значения — побеждает названное чаще", () => {
  assert.equal(findPrice([{ name: "a", text: "Цена товара 2 500 000 рублей. Обеспечение 5 %." }]), "");
  assert.equal(findPrice([{ name: "a", text: "Начальная (максимальная) цена контракта п. 7 срок 30 дней" }]), "");
  const text = ["НМЦК: 1 000 000", "Начальная (максимальная) цена контракта: 900 000", "Начальная (максимальная) цена контракта | 900 000"].join("\n");
  assert.equal(findPrice([{ name: "a", text }]), "900 000 ₽");
});

test("закон: чаще названный; не назван — пусто; способ — по словам документа, «единственный поставщик» сильнее общего «конкурс»", () => {
  assert.equal(findLaw([NOTICE]), "223");
  assert.equal(findLaw([{ name: "a", text: "по 44-ФЗ. Ст. 44 ФЗ. 44-ФЗ" }]), "44");
  assert.equal(findLaw([{ name: "a", text: "Закон не назван" }]), "");
  assert.equal(findMethod([NOTICE]), "электронный аукцион");
  assert.equal(findMethod([{ name: "a", text: "Закупка у единственного поставщика (подрядчика, исполнителя)" }]), "у единственного поставщика");
  assert.equal(findMethod([{ name: "a", text: "Открытый конкурс в электронной форме" }]), "электронный конкурс");
  assert.equal(findMethod([{ name: "a", text: "Текст без способа" }]), "");
  assert.equal(kindOf("223", "электронный аукцион"), "223-ФЗ · электронный аукцион");
  assert.equal(kindOf("", ""), "");
});

test("название, предмет и заказчик из извещения; нет предмета — название файла без расширения; пусто не выдумывается", () => {
  const intro = introOf([NOTICE, CONTRACT]);
  assert.equal(intro.subject, "Поставка угля каменного марки ДПК для нужд котельных");
  assert.equal(intro.title, "Поставка угля каменного марки ДПК для нужд котельных");
  assert.equal(intro.customer, "Муниципальное унитарное предприятие «Тепло»");
  assert.equal(intro.law, "223");
  assert.equal(intro.method, "электронный аукцион");
  const bare = introOf([{ name: "Закупка школа.pdf", text: "Просто текст без подписей" }]);
  assert.equal(bare.title, "Закупка школа");
  assert.equal(bare.subject, "");
  assert.equal(bare.customer, "");
  assert.equal(bare.price, "");
  assert.equal(introOf([]).title, "");
  const cell = introOf([{ name: "x", text: "Заказчик | ООО «Север»\nПредмет контракта | Ремонт крыши школы" }]);
  assert.equal(cell.customer, "ООО «Север»");
  assert.equal(cell.subject, "Ремонт крыши школы");
  const nextLine = introOf([{ name: "x", text: "Предмет закупки\nПоставка канцелярских товаров" }]);
  assert.equal(nextLine.subject, "Поставка канцелярских товаров");
});

test("закупка для «Аналитики»: документы, найденное и поправленное участником; требований нет, закон и способ в «kind»", () => {
  const docs = [NOTICE, CONTRACT];
  const intro = introOf(docs);
  const purchase = purchaseForAnalytics({
    id: "p1",
    createdAt: "2026-10-22T10:00:00.000Z",
    docs,
    failed: [{ name: "скан.pdf", reason: "скан" }],
    fields: { title: "Уголь для котельных", price: "26 000 000 ₽", law: "44" },
    intro,
  });
  assert.equal(purchase.id, "p1");
  assert.equal(purchase.short, "Уголь для котельных");
  assert.equal(purchase.subject, "Поставка угля каменного марки ДПК для нужд котельных");
  assert.equal(purchase.kind, "44-ФЗ · электронный аукцион");
  assert.equal(purchase.price, "26 000 000 ₽", "цена, которую поправил участник, главнее найденной");
  assert.deepEqual(purchase.files, ["Извещение.docx", "Проект договора.docx"]);
  assert.deepEqual(purchase.unreadable, [{ name: "скан.pdf", reason: "скан" }]);
  assert.deepEqual(purchase.requirements, { who: [], submit: [], scope: [], terms: [] });
  assert.equal(purchase.criteria?.rows.length, 0);
  const empty = purchaseForAnalytics({ id: "p2", createdAt: "x", docs: [], failed: [], fields: { title: "", price: "", law: "" }, intro: introOf([]) });
  assert.equal(empty.short, "Закупка без названия");
  assert.equal(empty.kind, "");
});
