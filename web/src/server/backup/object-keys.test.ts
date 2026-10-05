/**
 * S11-R0: S9 backup/restore обязан видеть все объекты S6, иначе новые объекты
 * (карты документов, текст/карта образцов) считались бы сиротами, а их потеря
 * при restore — не замечалась.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { OBJECT_KEYS_SQL, OBJECT_KEY_COLUMNS } from "./object-keys.ts";

test("SQL перечисляет ключи всех объектонесущих колонок", () => {
  for (const column of OBJECT_KEY_COLUMNS) {
    const [table, field] = column.split(".");
    assert.match(OBJECT_KEYS_SQL, new RegExp(`"${field}"[\\s\\S]*FROM "${table}"`), column);
  }
  assert.equal(OBJECT_KEY_COLUMNS.length, 5, "список не сузился без причины");
});
