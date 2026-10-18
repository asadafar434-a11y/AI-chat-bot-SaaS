// Цена по позициям с точностью до копейки — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { baseTotalKop, rubText, splitPrice, toKop, vatOf, type SplitPosition } from "./price-split.ts";

// Закупка школы № 196: начальные цены за единицу из расчёта НМЦК (среднее трёх предложений), НМЦД 1 704 386,67 ₽.
const SCHOOL: SplitPosition[] = [
  { name: "МФУ", qty: 4, baseKop: toKop(21121.5) },
  { name: "Компьютер в комплекте, тип 1", qty: 5, baseKop: toKop(70711.333333333) },
  { name: "Компьютер в комплекте, тип 2", qty: 14, baseKop: toKop(66477.666666667) },
  { name: "Компьютер в комплекте, тип 3", qty: 5, baseKop: toKop(67131.333333333) },
];
const NMCD = 170_438_667;

test("ловушка школы: начальные цены за единицу с копейками дают сумму на копейку выше НМЦД", () => {
  assert.equal(baseTotalKop(SCHOOL), NMCD + 1);
  assert.equal(rubText(baseTotalKop(SCHOOL)), "1 704 386,68 ₽");
  assert.equal(rubText(NMCD), "1 704 386,67 ₽");
});

test("итог равен НМЦД: цены за единицу подобраны так, что сумма — ровно 1 704 386,67 ₽, и каждая близка к начальной", () => {
  const split = splitPrice(SCHOOL, NMCD)!;
  assert.equal(split.totalKop, NMCD);
  assert.equal(split.shortKop, 0);
  assert.equal(split.lines.reduce((sum, l) => sum + l.qty * l.unitKop, 0), NMCD);
  for (const l of split.lines) assert.ok(Math.abs(l.unitKop - l.baseKop) <= 4, `${l.name}: ${l.unitKop} против ${l.baseKop}`);
});

test("снижение: цены за единицу пропорциональны начальным, сумма — ровно итог, не выше", () => {
  const target = toKop(1_650_000);
  const split = splitPrice(SCHOOL, target)!;
  assert.equal(split.totalKop, target);
  const ratio = target / baseTotalKop(SCHOOL);
  for (const l of split.lines) assert.ok(Math.abs(l.unitKop - l.baseKop * ratio) <= 4, l.name);
  // относительный порядок цен сохраняется
  const units = split.lines.map((l) => l.unitKop);
  assert.ok(units[1] > units[3] && units[3] > units[2] && units[2] > units[0]);
});

test("сумма никогда не выше итога, на разных итогах и количествах", () => {
  const positions: SplitPosition[] = [
    { name: "а", qty: 3, baseKop: 10_001 },
    { name: "б", qty: 7, baseKop: 2_503 },
    { name: "в", qty: 1, baseKop: 99_999 },
  ];
  for (let target = 50_000; target < 50_400; target += 7) {
    const split = splitPrice(positions, target)!;
    assert.ok(split.totalKop <= target && split.shortKop === target - split.totalKop, String(target));
    assert.equal(split.lines.reduce((sum, l) => sum + l.sumKop, 0), split.totalKop);
  }
});

test("количества не дают набрать итог точно — сумма ниже на несколько копеек, и это сказано", () => {
  const even = splitPrice([{ name: "а", qty: 2, baseKop: 1000 }, { name: "б", qty: 4, baseKop: 3000 }], 14_001)!;
  assert.equal(even.totalKop % 2, 0);
  assert.equal(even.shortKop, 14_001 - even.totalKop);
  assert.ok(even.shortKop >= 1);
  const single = splitPrice([{ name: "а", qty: 3, baseKop: 10_000 }], 29_999)!;
  assert.deepEqual([single.lines[0].unitKop, single.totalKop, single.shortKop], [9_999, 29_997, 2]);
});

test("негодные позиции и итог — null, а не выдуманные цифры", () => {
  assert.equal(splitPrice([], 100), null);
  assert.equal(splitPrice([{ name: "а", qty: 0, baseKop: 100 }], 100), null);
  assert.equal(splitPrice([{ name: "а", qty: 1.5, baseKop: 100 }], 100), null);
  assert.equal(splitPrice([{ name: "а", qty: 1, baseKop: 0 }], 100), null);
  assert.equal(splitPrice([{ name: "а", qty: 1, baseKop: 100 }], 0), null);
});

test("НДС: без НДС + НДС = с НДС всегда; ставка 0 — без НДС", () => {
  assert.deepEqual(vatOf(10_500, 5), { withoutKop: 10_000, vatKop: 500 });
  assert.deepEqual(vatOf(12_345, 0), { withoutKop: 12_345, vatKop: 0 });
  for (const rate of [5, 7, 10, 20, 22]) {
    for (let kop = 1; kop < 3000; kop += 37) {
      const v = vatOf(kop, rate);
      assert.equal(v.withoutKop + v.vatKop, kop);
    }
  }
});
