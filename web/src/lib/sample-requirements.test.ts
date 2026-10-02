// Пример закупки сам подчиняется правилам: его требования разобраны тем же кодом, что и настоящие, а в его ТП нет
// значений участника, взятых с границы заказчика — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { hintOf } from "./conditions.ts";
import { quoteChecker } from "./quotes.ts";
import { refineGroups, requirementOf, supplierChoices } from "./requirement-engine.ts";
import { SAMPLE_GROUPS, SAMPLE_SUMMARY } from "./requirements-sample.ts";
import { REQ_GROUP_KEYS } from "./requirements.ts";
import { SAMPLE_DOCUMENTS } from "./sample-purchase.ts";
import { guardContext, guardOffer, ownConditions } from "./tp-guard.ts";
import { SAMPLE_ITEMS } from "./tp-sample.ts";

const texts = SAMPLE_DOCUMENTS.map((d) => d.text);
const groups = refineGroups({ ...SAMPLE_GROUPS, price: SAMPLE_SUMMARY.price }, quoteChecker(texts));

test("требования примера: цитаты найдены в документах, чисел и сроков вне цитат нет, поля заполнены", () => {
  for (const key of REQ_GROUP_KEYS) {
    for (const it of groups[key]) {
      assert.equal(it.verified, true, `цитата не найдена: ${it.text}`);
      assert.equal(it.issues, undefined, `${it.text}: ${it.issues?.join("; ")}`);
      assert.ok(it.mandatory && it.type && it.numbers, it.text);
    }
  }
  assert.deepEqual(groups.submit.map((i) => i.type), ["document", "document"]);
  assert.equal(groups.terms.find((i) => i.text.startsWith("Подать заявку"))?.deadline, "до 30.09.2026 10:00 (МСК)");
});

test("границы заказчика в примере читаются из цитат: зал, участники, опыт, экран, фотографии, выпечка", () => {
  const choices = (starts: string) => {
    const it = groups.scope.find((i) => i.text.startsWith(starts))!;
    return supplierChoices(requirementOf(it, "scope")).map((c) => [c.what, c.op, c.parts ? c.parts.join("×") : c.value, c.unit]);
  };
  assert.deepEqual(choices("Зал"), [["вместимость зала", "min", 150, "мест"]]);
  assert.deepEqual(choices("Не менее 120"), [["участников мероприятия", "min", 120, "человек"]]);
  assert.deepEqual(choices("Ведущий"), [["опыт ведущего", "min", 3, "лет"]]);
  assert.deepEqual(choices("Звук"), [["размер экрана", "min", "3×2", "м"], ["радиомикрофонов", "min", 2, "радиомикрофонов"]]);
  assert.deepEqual(choices("Не менее 100"), [["обработанных фотографий", "min", 100, "обработанных фотографий"]]);
  assert.deepEqual(choices("Кофе-брейк"), [["", "min", 2, "наименований"]], "120 человек — точное значение заказчика, не выбор участника");
  // Срок заказчика («не позднее чем за 10 рабочих дней», «в течение 5 рабочих дней») участник не выбирает.
  assert.deepEqual(choices("Программу"), []);
  const photos = requirementOf(groups.scope.find((i) => i.text.startsWith("Не менее 100"))!, "scope");
  assert.equal(photos.numbers.some((c) => c.term && c.value === 5), true);
});

test("ТП примера: ни одного значения участника, взятого с границы заказчика, — на их местах пустые места с границей в подсказке", () => {
  const ctx = guardContext(texts);
  for (const it of SAMPLE_ITEMS) {
    const own = ownConditions(it.quote, it.requirement);
    assert.deepEqual(guardOffer(it.offer, own, ctx).hits, [], `${it.clause}: охрана нашла значение, выбранное за участника`);
    // Каждая граница пункта — как пустое место в предложении (кроме состава исполнителей: его участник вписывает таблицей).
    if (it.clause === "3.5") continue;
    for (const c of own.filter((x) => !x.term && x.op !== "exact")) {
      assert.ok(it.offer.includes(hintOf(c)!), `${it.clause}: нет места «${hintOf(c)}» в «${it.offer}»`);
    }
  }
});
