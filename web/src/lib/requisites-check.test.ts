// Проверка реквизитов — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_PROFILE } from "./profile.ts";
import { accountProblem, corrAccountProblem, innProblem, kppProblem, ogrnProblem, profileProblems } from "./requisites-check.ts";

// Реквизиты банков, опубликованные на их сайтах: контрольные цифры сходятся — значит, алгоритмы верные.
const BANKS = [
  { name: "Сбербанк", inn: "7707083893", kpp: "773601001", ogrn: "1027700132195", bik: "044525225", corr: "30101810400000000225" },
  { name: "ВТБ", inn: "7702070139", kpp: "770201001", ogrn: "1027739609391", bik: "044525187", corr: "30101810700000000187" },
  { name: "Альфа-Банк", inn: "7728168971", kpp: "770801001", ogrn: "1027700067328", bik: "044525593", corr: "30101810200000000593" },
  { name: "ТБанк", inn: "7710140679", kpp: "771301001", ogrn: "1027739642281", bik: "044525974", corr: "30101810145250000974" },
];

// Меняет одну цифру — так выглядит опечатка.
const typo = (value: string, at: number) => value.slice(0, at) + ((Number(value[at]) + 1) % 10) + value.slice(at + 1);

test("настоящие реквизиты банков проходят проверку", () => {
  for (const b of BANKS) {
    assert.equal(innProblem(b.inn), null, b.name);
    assert.equal(kppProblem(b.kpp), null, b.name);
    assert.equal(ogrnProblem(b.ogrn), null, b.name);
    assert.equal(corrAccountProblem(b.corr, b.bik), null, b.name);
  }
});

test("опечатка в одной цифре ловится", () => {
  for (const b of BANKS) {
    assert.match(innProblem(typo(b.inn, 3)) ?? "", /контрольная цифра ИНН/i, b.name);
    assert.match(ogrnProblem(typo(b.ogrn, 5)) ?? "", /контрольная цифра ОГРН/i, b.name);
    assert.match(corrAccountProblem(typo(b.corr, 12), b.bik) ?? "", /не сходится с БИК/, b.name);
  }
});

test("ИНН ИП из 12 цифр и ОГРНИП из 15", () => {
  assert.equal(innProblem("500100732259"), null);
  assert.match(innProblem("500100732258") ?? "", /контрольная цифра/i);
  // 15-я цифра — младший разряд остатка от деления первых 14 цифр на 13.
  const first14 = "30450011600015";
  const check = (Number(first14) % 13) % 10;
  assert.equal(ogrnProblem(first14 + check), null);
  assert.match(ogrnProblem(first14 + ((check + 1) % 10)) ?? "", /ОГРНИП/);
});

test("расчётный счёт сверяется с БИК", () => {
  assert.equal(accountProblem("40702810500000001234", "044525225"), null);
  assert.equal(accountProblem("40802810100000005678", "044525974"), null);
  assert.match(accountProblem("40702810600000001234", "044525225") ?? "", /не сходится с БИК/);
  // Тот же счёт в другом банке — тоже ошибка: чаще всего путают БИК.
  assert.match(accountProblem("40702810500000001234", "044525187") ?? "", /не сходится с БИК/);
  assert.match(accountProblem("4070281050000000123", "044525225") ?? "", /20 цифр/);
  // Казначейские и прочие счета — без проверки ключа: у них свои правила.
  assert.equal(accountProblem("03100643000000019500", "004525988"), null);
});

test("формат: пробелы не мешают, буквы и длина — подсказка", () => {
  assert.equal(innProblem("7707 083 893"), null);
  assert.match(innProblem("77070838") ?? "", /10 цифр у организации или 12 у ИП/);
  assert.equal(kppProblem("7736AB001"), null);
  assert.match(kppProblem("77360100") ?? "", /9 знаков/);
  assert.match(ogrnProblem("10277001321") ?? "", /13 цифр, ОГРНИП — 15/);
  assert.match(corrAccountProblem("40702810500000001234", "044525225") ?? "", /начинается с 301/);
});

test("реквизиты организации и ИП не смешиваются; пустые поля не проверяются", () => {
  assert.deepEqual(profileProblems(EMPTY_PROFILE), {});
  const sber = { ...EMPTY_PROFILE, inn: "7707083893", kpp: "773601001", ogrn: "1027700132195", bik: "044525225", corrAccount: "30101810400000000225", account: "40702810500000001234" };
  assert.deepEqual(profileProblems(sber), {});
  const ip = { ...EMPTY_PROFILE, inn: "500100732259", kpp: "773601001", ogrn: "1027700132195" };
  const problems = profileProblems(ip);
  assert.match(problems.kpp ?? "", /только у организации/);
  assert.match(problems.ogrn ?? "", /ОГРНИП из 15 цифр/);
  assert.equal(problems.inn, undefined);
});
