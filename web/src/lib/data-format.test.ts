// Формат записей в браузере: номер формата, миграции при чтении, записи новее приложения — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBackup, BACKUP_FORMAT, BACKUP_VERSION } from "./backup-format.ts";
import { formatOf, fromStore, migrate, NewerDataError, toStore, type Migration } from "./data-format.ts";
import { readMyDocument } from "./me-store.ts";
import type { Purchase } from "./purchase.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM } from "./tp.ts";

test("миграции идут по порядку, с номера записи; номер наружу не выходит", () => {
  const steps: Migration[] = [(r) => ({ ...r, log: [...(r.log as string[]), "1→2"] }), (r) => ({ ...r, log: [...(r.log as string[]), "2→3"] })];
  assert.deepEqual(migrate({ log: [] }, steps), { log: ["1→2", "2→3"] });
  assert.deepEqual(migrate({ log: [], v: 2 }, steps), { log: ["2→3"] });
  assert.deepEqual(migrate({ log: [], v: 3 }, steps), { log: [] });
  // Номер, которому нельзя верить, — первый формат.
  for (const v of ["2", 0, -1, 1.5, null]) assert.deepEqual(migrate({ log: [], v }, steps), { log: ["1→2", "2→3"] }, String(v));
});

test("запись новее приложения не читается: вкладку просят обновить", () => {
  assert.throws(() => fromStore("purchase", { id: "p1", v: formatOf("purchase") + 1 }), (e) => {
    assert.ok(e instanceof NewerDataError);
    assert.match(e.message, /более новой версией приложения — обновите страницу/);
    return true;
  });
  assert.throws(() => fromStore("document", { name: "ТЗ.pdf", text: "…", v: 99 }), NewerDataError);
});

test("закупка без номера — первый формат: старый черновик ТП списком открывается как ТП без формы", () => {
  const item = { text: "Звукорежиссёр на площадке", source: "ТЗ, п. 3", quote: "…", verified: true };
  const purchase = fromStore<Purchase>("purchase", { id: "p1", short: "Праздник", tp: [item] });
  assert.deepEqual(purchase.tp, { form: PLAIN_FORM, goods: [], items: [item], antiDumping: NO_ANTI_DUMPING });
  assert.equal("v" in purchase, false);
});

test("закупка в текущем формате: туда и обратно — без изменений, поля, которых код не знает, не теряются", () => {
  const purchase = { id: "p1", short: "Праздник", tp: { form: PLAIN_FORM, goods: [], items: [], antiDumping: NO_ANTI_DUMPING }, later: 1 };
  const stored = toStore("purchase", purchase);
  assert.equal(stored.v, formatOf("purchase"));
  assert.equal("v" in purchase, false, "исходная запись не меняется");
  assert.deepEqual(fromStore("purchase", stored), purchase);
});

test("документ участника: без видов — образец ТП, вида, которого нет, — «Другое»", () => {
  const old = { id: "d1", name: "ТП.docx", text: "…", addedAt: "2026-09-24T10:00:00.000Z" };
  assert.deepEqual(readMyDocument(old), { ...old, kinds: ["tp"], about: "" });
  // Вид убрали после того, как запись сохранена в текущем формате, — файл не пропадает из раздела.
  const current = toStore("myDocument", { ...old, kinds: ["protocols", "tp", "другое"], about: "ТП на праздник" });
  assert.deepEqual(readMyDocument(current).kinds, ["other", "tp"]);
});

test("копия данных: старые записи без номера принимаются, записи новее приложения — нет", () => {
  const backup = (over: object) => ({ format: BACKUP_FORMAT, version: BACKUP_VERSION, savedAt: "", purchases: [], documents: [], settings: [], samples: [], ...over });
  assert.equal(parseBackup(backup({ purchases: [{ id: "p1", tp: [] }] })).ok, true);
  const newer = [
    { purchases: [{ id: "p1", v: formatOf("purchase") + 1 }] },
    { purchases: [{ id: "p1" }], documents: [["p1", [{ name: "ТЗ.pdf", text: "…", v: formatOf("document") + 1 }]]] },
    { samples: [{ id: "d1", v: formatOf("myDocument") + 1 }] },
    { settings: [["profile", { inn: "7700000000", v: formatOf("profile") + 1 }]] },
  ];
  for (const over of newer) {
    const parsed = parseBackup(backup(over));
    assert.equal(parsed.ok, false, JSON.stringify(over));
    assert.match(!parsed.ok ? parsed.reason : "", /более новая версия приложения — обновите страницу/);
  }
});
