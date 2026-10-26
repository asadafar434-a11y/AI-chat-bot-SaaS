import assert from "node:assert/strict";
import { test } from "node:test";
import { findCoreModule } from "./index.ts";

test("реестр модулей: медицинский модуль доступен по ключу", () => {
  assert.equal(findCoreModule("medical")?.key, "medical");
});

test("реестр модулей: неизвестный модуль возвращает null", () => {
  assert.equal(findCoreModule("unknown"), null);
  assert.equal(findCoreModule(""), null);
  assert.equal(findCoreModule("__proto__"), null);
});
