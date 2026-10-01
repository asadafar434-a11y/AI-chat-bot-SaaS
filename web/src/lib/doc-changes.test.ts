// Что изменилось в документах закупки с тех пор, как по ним составили ТП, — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { changesText, docChanges, isChanged, stampsOf, tpChanges } from "./doc-changes.ts";

const docs = (...pairs: [string, string][]) => pairs.map(([name, text]) => ({ name, text }));
const BASE = docs(["Извещение.pdf", "Срок подачи — 10 октября"], ["ТЗ.docx", "Зал не менее 150 мест"]);

test("снимок документов: не зависит от порядка файлов, меняется вместе с содержимым", () => {
  assert.deepEqual(stampsOf(BASE), stampsOf([...BASE].reverse()));
  assert.deepEqual(stampsOf(BASE).map((d) => d.name), ["ТЗ.docx", "Извещение.pdf"].sort(), "имена по порядку — снимок один и тот же");
  const other = stampsOf(docs(["Извещение.pdf", "Срок подачи — 10 октября"], ["ТЗ.docx", "Зал не менее 200 мест"]));
  assert.equal(stampsOf(BASE).find((d) => d.name === "Извещение.pdf")?.key, other.find((d) => d.name === "Извещение.pdf")?.key);
  assert.notEqual(stampsOf(BASE).find((d) => d.name === "ТЗ.docx")?.key, other.find((d) => d.name === "ТЗ.docx")?.key);
  assert.deepEqual(stampsOf([]), []);
});

test("что изменилось: добавлен, убран, заменён новой версией; переименованный — это убранный и добавленный", () => {
  const before = stampsOf(BASE);
  assert.deepEqual(docChanges(before, stampsOf(BASE)), { added: [], removed: [], changed: [] });
  assert.equal(isChanged(docChanges(before, stampsOf(BASE))), false);

  const next = docs(["Извещение.pdf", "Срок подачи — 10 октября"], ["ТЗ.docx", "Зал не менее 200 мест"], ["Изменения.pdf", "…"]);
  assert.deepEqual(docChanges(before, stampsOf(next)), { added: ["Изменения.pdf"], removed: [], changed: ["ТЗ.docx"] });
  assert.deepEqual(docChanges(before, stampsOf(BASE.slice(0, 1))), { added: [], removed: ["ТЗ.docx"], changed: [] });
  assert.deepEqual(docChanges(before, stampsOf(docs(["Извещение.pdf", "Срок подачи — 10 октября"], ["ТЗ-новое.docx", "Зал не менее 150 мест"]))), {
    added: ["ТЗ-новое.docx"],
    removed: ["ТЗ.docx"],
    changed: [],
  });
  assert.equal(isChanged(docChanges(before, stampsOf(next))), true);
  // Порядок файлов в закупке не считается изменением: добавка того же файла переставляет его в конец.
  assert.equal(isChanged(docChanges(before, stampsOf([...BASE].reverse()))), false);
});

test("ТП помечается, только когда известно, по каким документам оно составлено, и в закупке теперь другие", () => {
  const tp = { form: {} };
  const was = stampsOf(BASE);
  const now = stampsOf(docs(["Извещение.pdf", "Срок подачи — 10 октября"], ["ТЗ.docx", "Зал не менее 200 мест"]));
  assert.deepEqual(tpChanges({ tp, docs: now, tpDocs: was }), { added: [], removed: [], changed: ["ТЗ.docx"] });
  assert.equal(tpChanges({ tp, docs: was, tpDocs: was }), null, "документы те же — пометки нет");
  // Участник подтвердил: снимок ТП стал равен снимку закупки — пометка снята.
  assert.equal(tpChanges({ tp, docs: now, tpDocs: now }), null);
  // Нечего сказать: ТП ещё нет; закупка сохранена до этой проверки и снимков нет — не тревожим зря.
  assert.equal(tpChanges({ docs: now, tpDocs: was }), null);
  assert.equal(tpChanges({ tp, docs: now }), null);
  assert.equal(tpChanges({ tp, tpDocs: was }), null);
  assert.equal(tpChanges({ tp }), null);
});

test("словами: один файл и несколько; длинный список — первые три и «и ещё N»", () => {
  assert.equal(changesText({ added: ["Изменения.pdf"], removed: [], changed: [] }), "добавлен файл «Изменения.pdf»");
  assert.equal(changesText({ added: ["А", "Б"], removed: [], changed: [] }), "добавлены файлы «А», «Б»");
  assert.equal(
    changesText({ added: ["Изменения.pdf"], removed: ["Старое.pdf"], changed: ["ТЗ.docx"] }),
    "добавлен файл «Изменения.pdf»; изменён файл «ТЗ.docx»; убран файл «Старое.pdf»"
  );
  assert.equal(changesText({ added: ["1", "2", "3", "4", "5"], removed: [], changed: [] }), "добавлены файлы «1», «2», «3» и ещё 2");
  assert.equal(changesText({ added: [], removed: [], changed: [] }), "");
});
