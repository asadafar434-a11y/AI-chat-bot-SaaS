// Разбор запроса «рыночный ориентир по позициям»: только название, единица, количество, регион; лишнее не принимается — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_POSITIONS, parseMarketRequest } from "./market-request.ts";

test("запрос: позиции с названием, единицей, количеством и регионом; пробелы схлопываются, дата расчёта необязательна", () => {
  const r = parseMarketRequest({ positions: [{ key: "a", name: "  Уголь   каменный ДПК ", unit: "т", quantity: 1500, region: "Севастополь" }, { name: "Сахар песок" }], onDate: "2026-10-22" });
  assert.ok(r.ok);
  assert.deepEqual(r.value.positions[0], { key: "a", target: { name: "Уголь каменный ДПК", unit: "т", quantity: 1500, region: "Севастополь" } });
  assert.equal(r.value.positions[1].key, "1", "без ключа — порядковый номер");
  assert.deepEqual(r.value.positions[1].target, { name: "Сахар песок", unit: "", quantity: null, region: null });
  assert.equal(r.value.onDate, "2026-10-22");
});

test("запрос: нет позиций, нет названия, повтор ключа, слишком много позиций — отказ с понятным текстом", () => {
  const error = (body: unknown) => {
    const r = parseMarketRequest(body);
    return r.ok ? null : r.error;
  };
  assert.match(error(null)!, /Нужен запрос/);
  assert.match(error({ positions: [] })!, /Нет позиций/);
  assert.match(error({ positions: [{ name: "" }] })!, /нет названия/);
  assert.match(error({ positions: [{ key: "x", name: "Уголь" }, { key: "x", name: "Сахар" }] })!, /Ключ позиции повторяется/);
  assert.match(error({ positions: Array.from({ length: MAX_POSITIONS + 1 }, (_, i) => ({ key: String(i), name: "Уголь" })) })!, /слишком много/);
});

test("запрос: количество не число или не больше нуля — не берётся; кривая дата расчёта — не берётся; слишком длинное название обрезается", () => {
  const r = parseMarketRequest({ positions: [{ name: "Уголь ДПК".padEnd(500, "я"), quantity: -5 }, { name: "Сахар", quantity: "10" }], onDate: "22.10.2026" });
  assert.ok(r.ok);
  assert.equal(r.value.positions[0].target.name.length, 300);
  assert.equal(r.value.positions[0].target.quantity, null);
  assert.equal(r.value.positions[1].target.quantity, null);
  assert.equal(r.value.onDate, null);
});
