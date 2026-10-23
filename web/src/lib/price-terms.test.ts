// Шаг аукциона и «коэффициент снижения» из документов закупки — npm test (без ИИ).
import assert from "node:assert/strict";
import { test } from "node:test";
import { auctionStepNote, findAuctionStep, mentionsReductionCoefficient, reductionCoefficientNote, vatOnTopNote } from "./price-terms.ts";

// Пробелы в числах (неразрывные, узкие) приводим к обычным.
const flat = (s: string | null) => s?.replace(/\s/g, " ") ?? null;
const doc = (text: string) => [{ name: "Документация.docx", text }];

test("шаг аукциона «от 0,5 % до 5 %»: сумма шага от начальной цены считается в копейках", () => {
  const docs = doc("Размер шага аукциона устанавливается в размере от 0,5% до 5 % от начальной (максимальной) цены договора.");
  assert.deepEqual(findAuctionStep(docs), { from: 0.5, to: 5, text: ["0,5", "5"] });
  assert.equal(flat(auctionStepNote(docs, 3_097_718.1)), "Шаг аукциона по документам — от 0,5 % до 5 % начальной цены: от 15 488,59 ₽ до 154 885,91 ₽ за один шаг");
  assert.equal(auctionStepNote(docs, null), "Шаг аукциона по документам — от 0,5 % до 5 % начальной цены");
});

test("шаг аукциона в таблице документации: «Шаг аукциона: | 0,5% – 5,0% от НМЦ, что составляет: …» — диапазон через тире, а не одно число", () => {
  const docs = doc("1.2.13 | Шаг аукциона: | 0,5% – 5,0% от НМЦ, что составляет: 46 528,25 руб. – 465 282,58 руб., без учета НДС.");
  assert.deepEqual(findAuctionStep(docs), { from: 0.5, to: 5, text: ["0,5", "5,0"] });
  assert.equal(flat(auctionStepNote(docs, 9_305_651.64)), "Шаг аукциона по документам — от 0,5 % до 5,0 % начальной цены: от 46 528,26 ₽ до 465 282,58 ₽ за один шаг");
});

test("шаг аукциона одним числом: «шаг аукциона — 1 процент»", () => {
  const docs = doc("Шаг аукциона составляет 1 процент начальной цены контракта.");
  assert.equal(flat(auctionStepNote(docs, 17_000_000)), "Шаг аукциона по документам — 1 % начальной цены: 170 000,00 ₽ за один шаг");
});

test("шаг аукциона не называют (только в заголовке графы) — молчим", () => {
  assert.equal(auctionStepNote(doc("величина понижения начальной цены («шаг аукциона»): электронный аукцион на площадке"), 1_000_000), null);
  assert.equal(auctionStepNote(doc("Срок поставки — 10 дней."), 1_000_000), null);
});

test("коэффициент снижения: показываем, только если о нём написано в документах", () => {
  const docs = doc("2.1. Стоимость работ составляет ____ на основании Приложения № 1 с учетом коэффициента снижения.");
  assert.equal(mentionsReductionCoefficient(docs), true);
  assert.match(reductionCoefficientNote(docs, 3_097_718.1, null) ?? "", /Выберите цену — покажу коэффициент$/);
  assert.match(flat(reductionCoefficientNote(docs, 3_097_718.1, 2_633_020.39)) ?? "", /при вашей цене коэффициент 0,8500$/);
  assert.equal(reductionCoefficientNote(doc("Цена договора фиксированная."), 3_097_718.1, 2_633_020.39), null);
});

test("цена без НДС и налог сверху — пометка только при обоих признаках", () => {
  const both = [{ name: "Договор.docx", text: "2. Цена за 1 тонну Товара составляет 8 000 рублей, без учета НДС. Сумма НДС должна быть оплачена Покупателем при оплате стоимости Товара." }];
  assert.equal(vatOnTopNote(both), "Цена по документам — без НДС: налог покупатель платит сверху. Свою цену считайте без НДС");
  assert.equal(vatOnTopNote([{ name: "Договор.docx", text: "Цена договора составляет 8 000 рублей, в том числе НДС 22 %." }]), null);
  assert.equal(vatOnTopNote([{ name: "Договор.docx", text: "Цена договора 8 000 рублей без НДС." }]), null);
});
