// Хранилище расчётов раздела «Аналитика» в браузере: сохранить РИЦ по закупке, прочитать, убрать — и стереться вместе со всеми данными — npm test.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { deleteRicOf, getRic, saveRic } from "./analytics-store.ts";
import { deleteDatabases } from "./db.ts";
import { DEFAULT_SETTINGS, type RicData } from "./indicative-price.ts";
import { installFakeIndexedDB, type FakeIndexedDb } from "./testing/fake-indexeddb.ts";

let fake: FakeIndexedDb;
before(() => {
  fake = installFakeIndexedDB();
});
beforeEach(() => fake.reset());
after(() => fake.uninstall());

const sample = (name: string): RicData => ({
  settings: { ...DEFAULT_SETTINGS, nmckVat: "without" },
  positions: [{ id: "p1", name, unit: "т", qty: "2 900", analogs: [{ id: "a1", price: "8941,38", vat: "without", source: "КП ООО «Север»", date: "2026-09-15" }] }],
});

test("расчёт лежит по закупке: читается как записан, перезаписывается, удаляется, чужая закупка не тронута", async () => {
  assert.equal(await getRic("p1"), undefined);
  await saveRic("p1", sample("Уголь"));
  await saveRic("p2", sample("Кран"));
  const first = (await getRic("p1"))!;
  assert.equal(first.positions[0].name, "Уголь");
  assert.equal(first.positions[0].analogs[0].price, "8941,38");
  assert.equal(first.settings.nmckVat, "without");
  await saveRic("p1", sample("Уголь каменный"));
  assert.equal((await getRic("p1"))!.positions[0].name, "Уголь каменный");
  await deleteRicOf("p1");
  assert.equal(await getRic("p1"), undefined);
  assert.equal((await getRic("p2"))!.positions[0].name, "Кран", "расчёт другой закупки на месте");
});

test("«Удалить все данные» стирает и расчёты аналитики: они лежат в базе, которую удаляет общий сброс", async () => {
  await saveRic("p1", sample("Уголь"));
  assert.equal(await deleteDatabases(), "done");
  assert.equal(await getRic("p1"), undefined);
});
