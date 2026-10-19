// Хранилище Excel-бланков заказчика в браузере: сохранить, найти по закупке, убрать — и стереться вместе со всеми данными — npm test.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { deleteDatabases } from "./db.ts";
import { deleteForm, deleteFormsOf, getForm, isOpenXmlName, listForms, saveExcelFiles, saveForm } from "./forms-store.ts";
import { installFakeIndexedDB, type FakeIndexedDb } from "./testing/fake-indexeddb.ts";

let fake: FakeIndexedDb;
before(() => {
  fake = installFakeIndexedDB();
});
beforeEach(() => fake.reset());
after(() => fake.uninstall());

test("сохранённый бланк находится по закупке, возвращается теми же байтами, удаляется по одному и все сразу", async () => {
  const bytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3]).buffer;
  await saveForm("p1", "Анкета.xlsx", bytes);
  await saveForm("p1", "КП.xlsx", new Uint8Array([9, 9]).buffer);
  await saveForm("p2", "Анкета.xlsx", new Uint8Array([7]).buffer);
  assert.deepEqual((await listForms("p1")).map((f) => [f.name, f.size]), [["Анкета.xlsx", 7], ["КП.xlsx", 2]]);
  assert.deepEqual([...(await getForm("p1", "Анкета.xlsx"))!], [80, 75, 3, 4, 1, 2, 3]);
  assert.equal(await getForm("p1", "нет.xlsx"), undefined);
  await deleteForm("p1", "КП.xlsx");
  assert.deepEqual((await listForms("p1")).map((f) => f.name), ["Анкета.xlsx"]);
  await deleteFormsOf("p1");
  assert.deepEqual(await listForms("p1"), []);
  assert.equal((await listForms("p2")).length, 1, "бланки другой закупки не тронуты");
});

test("при загрузке сохраняются только Excel нового формата и не больше 3 МБ; старый .xls и прочее — нет", async () => {
  const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);
  const saved = await saveExcelFiles("p1", [file("a.xlsx"), file("b.xlsm"), file("c.xls"), file("d.docx"), file("big.xlsx", 3 * 1024 * 1024 + 1)]);
  assert.deepEqual(saved, ["a.xlsx", "b.xlsm"]);
  assert.deepEqual((await listForms("p1")).map((f) => f.name), ["a.xlsx", "b.xlsm"]);
  assert.equal(isOpenXmlName("x.XLSX"), true);
  assert.equal(isOpenXmlName("x.xls"), false);
});

test("«Удалить все данные» стирает и Excel-бланки: они лежат в базе, которую удаляет общий сброс", async () => {
  await saveForm("p1", "Анкета.xlsx", new Uint8Array([1]).buffer);
  assert.equal((await listForms("p1")).length, 1);
  assert.equal(await deleteDatabases(), "done");
  assert.deepEqual(await listForms("p1"), []);
});
