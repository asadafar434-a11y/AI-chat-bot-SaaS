import assert from "node:assert/strict";
import { test } from "node:test";
import { findCoreModule } from "./index.ts";

test("реестр модулей: все сферы доступны по ключу", () => {
  assert.equal(findCoreModule("medical")?.key, "medical");
  assert.equal(findCoreModule("office-equipment")?.key, "office-equipment");
  assert.equal(findCoreModule("furniture")?.key, "furniture");
  assert.equal(findCoreModule("stationery")?.key, "stationery");
  assert.equal(findCoreModule("workwear")?.key, "workwear");
  assert.equal(findCoreModule("automobiles")?.key, "automobiles");
  assert.equal(findCoreModule("building-materials")?.key, "building-materials");
  assert.equal(findCoreModule("educational-equipment")?.key, "educational-equipment");
  assert.equal(findCoreModule("insurance")?.key, "insurance");
  assert.equal(findCoreModule("medical-services")?.key, "medical-services");
  assert.equal(findCoreModule("training")?.key, "training");
  assert.equal(findCoreModule("events")?.key, "events");
  assert.equal(findCoreModule("legal-services")?.key, "legal-services");
  assert.equal(findCoreModule("construction")?.key, "construction");
  assert.equal(findCoreModule("energy")?.key, "energy");
  assert.equal(findCoreModule("transport")?.key, "transport");
  assert.equal(findCoreModule("utilities")?.key, "utilities");
  assert.equal(findCoreModule("design-surveys")?.key, "design-surveys");
  assert.equal(findCoreModule("real-estate")?.key, "real-estate");
  assert.equal(findCoreModule("it-communications")?.key, "it-communications");
  assert.equal(findCoreModule("science-research")?.key, "science-research");
  assert.equal(findCoreModule("security-cleaning-catering")?.key, "security-cleaning-catering");
  assert.equal(findCoreModule("toro")?.key, "toro");
  assert.equal(findCoreModule("defense-order")?.key, "defense-order");
  assert.equal(findCoreModule("food")?.key, "food");
});

test("реестр модулей: неизвестный модуль возвращает null", () => {
  assert.equal(findCoreModule("unknown"), null);
  assert.equal(findCoreModule(""), null);
  assert.equal(findCoreModule("__proto__"), null);
});
