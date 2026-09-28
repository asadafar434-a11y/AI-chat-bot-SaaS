// Копия данных файлом — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKUP_FORMAT, buildBackup, missingFrom, parseBackup, profileFilled, type Dump } from "./backup-format.ts";

const dump: Dump = {
  purchases: [{ id: "p1" }, { id: "p2" }],
  documents: [["p1", [{ name: "ТЗ.pdf", text: "…" }]]],
  settings: [
    ["profile", { inn: "7700000000" }],
    ["profile-meta", { sources: {}, suggestions: [] }],
    ["что-то-ещё", { x: 1 }],
  ],
  samples: [{ id: "s1" }],
};

test("копия и обратно — то же самое, лишние настройки не попадают", () => {
  const backup = buildBackup(dump, new Date("2026-09-26T12:00:00Z"));
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.savedAt, "2026-09-26T12:00:00.000Z");
  assert.deepEqual(backup.settings.map(([k]) => k), ["profile", "profile-meta"]);
  const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
  assert.ok(parsed.ok);
  if (parsed.ok) {
    assert.deepEqual(parsed.dump.purchases, dump.purchases);
    assert.deepEqual(parsed.dump.documents, dump.documents);
    assert.deepEqual(parsed.dump.samples, dump.samples);
  }
});

test("чужой файл, другая версия и пустая копия не принимаются", () => {
  assert.deepEqual(parseBackup({ hello: 1 }), { ok: false, reason: "Это не копия данных «Тендерного юриста»." });
  assert.equal(parseBackup(null).ok, false);
  const other = { ...buildBackup(dump), version: 99 };
  assert.match((parseBackup(other) as { reason: string }).reason, /другой версией/);
  const empty = buildBackup({ purchases: [], documents: [], settings: [], samples: [] });
  assert.equal(parseBackup(empty).ok, false);
});

test("битые записи отбрасываются, целые остаются", () => {
  const raw = {
    ...buildBackup(dump),
    purchases: [{ id: "p1" }, { id: "" }, "мусор", null, { noId: true }],
    documents: [["p1", []], ["p2", "не массив"], [5, []]],
    settings: [["profile", { inn: "1" }], ["profile", "не объект"]],
  };
  const parsed = parseBackup(raw);
  assert.ok(parsed.ok);
  if (parsed.ok) {
    assert.deepEqual(parsed.dump.purchases, [{ id: "p1" }]);
    assert.deepEqual(parsed.dump.documents, [["p1", []]]);
    assert.deepEqual(parsed.dump.settings, [["profile", { inn: "1" }]]);
  }
});

test("загрузка копии ничего не затирает: только то, чего нет в браузере", () => {
  const add = missingFrom(dump, { purchases: new Set(["p1"]), samples: new Set(), profile: true });
  assert.deepEqual(add.purchases, [{ id: "p2" }]);
  assert.deepEqual(add.documents, []);
  assert.deepEqual(add.samples, [{ id: "s1" }]);
  assert.deepEqual(add.settings, []);

  const empty = missingFrom(dump, { purchases: new Set(), samples: new Set(["s1"]), profile: false });
  assert.deepEqual(empty.purchases.map((p) => p.id), ["p1", "p2"]);
  assert.deepEqual(empty.documents.map(([id]) => id), ["p1"]);
  assert.deepEqual(empty.samples, []);
  assert.equal(empty.settings.length, 3);
});

test("реквизиты вписаны, если заполнено хоть одно поле", () => {
  assert.equal(profileFilled(undefined), false);
  assert.equal(profileFilled({ inn: "", name: "  " }), false);
  assert.equal(profileFilled({ inn: "7700000000", name: "" }), true);
});
