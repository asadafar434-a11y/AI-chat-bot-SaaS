import assert from "node:assert/strict";
import { test } from "node:test";
import { findCoreModule } from "./index.ts";

test("реестр модулей: медицинский и офисный модули доступны по ключу", () => {
  assert.equal(findCoreModule("medical")?.key, "medical");
  assert.equal(findCoreModule("office-equipment")?.key, "office-equipment");
});

test("реестр модулей: неизвестный модуль возвращает null", () => {
  assert.equal(findCoreModule("unknown"), null);
  assert.equal(findCoreModule(""), null);
  assert.equal(findCoreModule("__proto__"), null);
});
