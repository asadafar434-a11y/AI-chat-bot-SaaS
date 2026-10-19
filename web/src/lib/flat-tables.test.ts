// Предупреждение о таблицах старого .doc с объединёнными ячейками — npm test (без ИИ).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractText } from "./extract-text.ts";
import { flatTableCount, flatTableWarning } from "./flat-tables.ts";

const KB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
async function read(dir: string, name: string) {
  const r = await extractText(new File([new Uint8Array(readFileSync(path.join(KB, dir, name)))], name), { ocr: false });
  assert.ok(r.ok, `${name} не прочитан`);
  return { name, text: r.text };
}

test("ТЗ угля (.doc): таблица с объединёнными заголовками — плоская, предупреждение называет файл", async () => {
  const tz = await read("МУП Тепло Корсаков (аукцион 223-ФЗ, уголь)", "Описание объекта закупки.doc");
  assert.equal(flatTableCount(tz.text), 1);
  const warning = flatTableWarning([tz]) ?? "";
  assert.match(warning, /^В «Описание объекта закупки\.doc» есть таблица с объединёнными ячейками в старом формате \.doc/);
  assert.match(warning, /пересохраните файл как \.docx/);
});

test("обычные таблицы .doc (спецификация, реквизиты, график) и все остальные эталонные файлы .doc предупреждения не дают", async () => {
  const docs = await Promise.all([
    read("Школа № 196 (неконкурентная закупка СМСП)", "Проект договора.doc"),
    read("Школа № 196 (неконкурентная закупка СМСП)", "Извещение.doc"),
    read("ЖКС Петродворца (аукцион 223-ФЗ, ремонт балконов)", "Приложение № 4 Проект договора.doc"),
    read("ДРСУ Камчатка (у единственного поставщика, дизтопливо)", "Извещение на закупку у ЕП.doc"),
  ]);
  assert.equal(flatTableWarning(docs), null);
});

test("синтетика: ровная таблица — нет; строки с 2, 3 и 9 ячейками — да; только для имён .doc (не .docx)", () => {
  const even = ["№\tНазвание\tКол-во", "1\tБумага\t10", "2\tРучки\t5", "3\tСкрепки\t7"].join("\n");
  assert.equal(flatTableCount(even), 0);
  const merged = ["Товар\tКоличество\tПоказатели", "Зольность\tВлага", "всего\tпериоды\tсредняя\tпредельная\tсредняя\tпредельная", "авг\tсен\tокт\tноя\tдек\tянв\tфев\tмар\tапр"].join("\n");
  assert.equal(flatTableCount(merged), 1);
  assert.match(flatTableWarning([{ name: "ТЗ.doc", text: merged }]) ?? "", /«ТЗ\.doc»/);
  assert.equal(flatTableWarning([{ name: "ТЗ.docx", text: merged }]), null, ".docx читается по ячейкам — предупреждения нет");
  const many = Array.from({ length: 5 }, (_, i) => ({ name: `Файл ${i + 1}.doc`, text: merged }));
  assert.match(flatTableWarning(many) ?? "", /«Файл 1\.doc», «Файл 2\.doc», «Файл 3\.doc» и ещё 2 есть таблица/);
});
