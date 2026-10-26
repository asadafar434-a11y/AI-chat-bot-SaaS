import assert from "node:assert/strict";
import { test } from "node:test";
import { matchCharacteristics } from "./characteristics.ts";

test("matcher: регистр, пробелы и единицы нормализуются", () => {
  const result = matchCharacteristics(
    [{ name: "Масса", value: 10, unit: "кг" }],
    [{ name: " масса ", value: 10, unit: "КГ" }]
  );

  assert.equal(result.matched, true);
  assert.deepEqual(result.mismatches, []);
});

test("matcher: gte проходит на большем значении", () => {
  const result = matchCharacteristics(
    [{ name: "Скорость", value: 30, unit: "стр/мин", op: "gte" }],
    [{ name: "Скорость", value: 35, unit: "стр/мин" }]
  );

  assert.equal(result.matched, true);
});

test("matcher: gte падает на меньшем значении", () => {
  const result = matchCharacteristics(
    [{ name: "Скорость", value: 30, unit: "стр/мин", op: "gte" }],
    [{ name: "Скорость", value: 25, unit: "стр/мин" }]
  );

  assert.equal(result.matched, false);
  assert.equal(result.mismatches[0]?.reason, "op");
});

test("matcher: разные единицы — расхождение", () => {
  const result = matchCharacteristics(
    [{ name: "Масса", value: 10, unit: "кг" }],
    [{ name: "Масса", value: 10, unit: "г" }]
  );

  assert.equal(result.matched, false);
  assert.equal(result.mismatches[0]?.reason, "unit");
});

test("matcher: характеристики товара нет", () => {
  const result = matchCharacteristics(
    [{ name: "Масса", value: 10, unit: "кг" }],
    [{ name: "Мощность", value: 100, unit: "Вт" }]
  );

  assert.equal(result.matched, false);
  assert.equal(result.mismatches[0]?.reason, "missing");
  assert.equal(result.mismatches[0]?.offered, null);
});

test("matcher: includes проверяет вхождение", () => {
  const result = matchCharacteristics(
    [{ name: "Комплектация", value: "кабель", op: "includes" }],
    [{ name: "Комплектация", value: "Кабель питания и инструкция" }]
  );

  assert.equal(result.matched, true);
});

test("matcher: лишние характеристики товара не мешают", () => {
  const result = matchCharacteristics(
    [{ name: "Масса", value: 10, unit: "кг" }],
    [
      { name: "Масса", value: 10, unit: "кг" },
      { name: "Цвет", value: "белый" },
    ]
  );

  assert.equal(result.matched, true);
});

test("matcher: пустой или битый вход — missing, а не ложное совпадение", () => {
  const empty = matchCharacteristics([], null);
  const malformed = matchCharacteristics([{ name: "", value: 10 }], [{ name: "Масса", value: 10 }]);

  assert.deepEqual(empty.missing, ["requiredCharacteristics", "productCharacteristics"]);
  assert.deepEqual(malformed.missing, ["requiredCharacteristics"]);
  assert.equal(empty.matched, false);
  assert.equal(malformed.matched, false);
});
