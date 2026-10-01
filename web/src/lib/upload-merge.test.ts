// Файлы добавляют по несколько раз: добавки складываются, новая версия заменяет старую, сбои не забываются — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeUpload, type Upload } from "./upload-merge.ts";

const doc = (name: string, text = "текст") => ({ name, text });
const fail = (name: string, reason = "не прочитан") => ({ name, reason });
const none: Upload = { documents: [], failed: [] };

test("добавки складываются: прочитанные — к прочитанным, непрочитанные — к непрочитанным", () => {
  const first = mergeUpload(none, { documents: [doc("ТЗ.docx")], failed: [fail("скан.pdf", "скан не читается")] });
  const second = mergeUpload(first, { documents: [doc("Извещение.pdf")], failed: [] });
  assert.deepEqual(second.documents.map((d) => d.name), ["ТЗ.docx", "Извещение.pdf"]);
  // Раньше сбой первой добавки пропадал, как только вторая проходила без сбоев, и заявка о нём «забывала».
  assert.deepEqual(second.failed, [fail("скан.pdf", "скан не читается")]);
});

test("файл с тем же именем — новая версия: заменяет прежнюю, а не теряется молча", () => {
  const first = mergeUpload(none, { documents: [doc("ТЗ.docx", "версия 1"), doc("Извещение.pdf")], failed: [] });
  const second = mergeUpload(first, { documents: [doc("ТЗ.docx", "версия 2")], failed: [] });
  assert.deepEqual(second.documents, [doc("Извещение.pdf"), doc("ТЗ.docx", "версия 2")]);
});

test("непрочитанный файл забывается, только когда его прочитали; новый сбой того же файла заменяет прежний", () => {
  const first = mergeUpload(none, { documents: [doc("А.docx")], failed: [fail("скан.pdf", "причина 1"), fail("Б.pdf", "причина Б")] });
  const retry = mergeUpload(first, { documents: [], failed: [fail("скан.pdf", "причина 2")] });
  assert.deepEqual(retry.failed, [fail("Б.pdf", "причина Б"), fail("скан.pdf", "причина 2")]);
  const fixed = mergeUpload(retry, { documents: [doc("скан.pdf", "распознан")], failed: [] });
  assert.deepEqual(fixed.failed, [fail("Б.pdf", "причина Б")]);
  assert.deepEqual(fixed.documents.map((d) => d.name), ["А.docx", "скан.pdf"]);
});

test("новая версия не прочиталась: прежняя остаётся в закупке, а сбой записан — человек видит и то, и другое", () => {
  const first = mergeUpload(none, { documents: [doc("ТЗ.docx", "версия 1")], failed: [] });
  const second = mergeUpload(first, { documents: [doc("Извещение.pdf")], failed: [fail("ТЗ.docx", "файл повреждён")] });
  assert.deepEqual(second.documents.map((d) => d.name), ["ТЗ.docx", "Извещение.pdf"]);
  assert.deepEqual(second.failed, [fail("ТЗ.docx", "файл повреждён")]);
});

test("пустая добавка ничего не меняет, а прежнее состояние не портится", () => {
  const base = mergeUpload(none, { documents: [doc("А")], failed: [fail("Б")] });
  const copy = JSON.stringify(base);
  assert.deepEqual(mergeUpload(base, none), base);
  assert.equal(JSON.stringify(base), copy);
});
