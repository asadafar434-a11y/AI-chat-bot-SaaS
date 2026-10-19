// Скрытое в файлах заявки: находится при чтении и называется только там, где заказчик это запрещает — npm test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { docx, para } from "./docx-fixtures.ts";
import { extractText } from "./extract-text.ts";
import { forbidsHidden, hiddenWarning } from "./hidden-content.ts";
import { xlsxText } from "./xlsx-text.ts";

const FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
async function read(dir: string, name: string) {
  const r = await extractText(new File([new Uint8Array(readFileSync(path.join(FOLDER, dir, name)))], name), { ocr: false });
  assert.ok(r.ok, name);
  return { name, text: r.text };
}

test("Excel: скрытый лист, скрытые строки и столбцы с содержимым находятся; пустой скрытый столбец не в счёт", async () => {
  const book = new ExcelJS.Workbook();
  const open = book.addWorksheet("Расчёт");
  open.addRow(["Позиция", "Цена", "Заметка"]);
  open.addRow(["Бумага", 100, "для себя"]);
  open.addRow(["Ручки", 50, "тоже"]);
  open.getRow(3).hidden = true;
  open.getColumn(3).hidden = true;
  open.getColumn(5).hidden = true;
  const secret = book.addWorksheet("Себестоимость");
  secret.addRow(["Закупка", 70]);
  secret.state = "hidden";
  const { text, hidden } = await xlsxText(Buffer.from(await book.xlsx.writeBuffer()));
  assert.deepEqual(hidden, ["на листе «Расчёт» скрыты строки: 1", "на листе «Расчёт» скрыты столбцы: 1", "лист «Себестоимость» скрыт"]);
  assert.ok(!text.includes("Закупка"), "скрытый лист в текст по-прежнему не попадает");
});

test("Excel без скрытого — списка нет; Word: скрытый шрифт находится, «не скрытый» (w:val=0) — нет", async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Лист1").addRow(["а", "б"]);
  const plain = await xlsxText(Buffer.from(await book.xlsx.writeBuffer()));
  assert.deepEqual(plain.hidden, []);
  const file = (xml: string) => new File([new Uint8Array(docx({ body: para(xml) }))], "заявка.docx");
  const hiddenWord = await extractText(file("<w:r><w:rPr><w:vanish/></w:rPr><w:t>скрыто</w:t></w:r>"), { ocr: false });
  assert.deepEqual(hiddenWord.ok && hiddenWord.hidden, ["в тексте есть скрытый шрифт"]);
  const shown = await extractText(file('<w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>видно</w:t></w:r>'), { ocr: false });
  assert.equal(shown.ok && shown.hidden, undefined);
});

test("запрет скрытого — настоящая фраза из «Форумной дирекции»; в закупках школы и детсадов такого запрета нет", async () => {
  const forum = await read("Форумная дирекция (конкурс МСП)", "Конкурсная документация - 130.docx");
  assert.equal(forbidsHidden([forum]), true);
  assert.equal(forbidsHidden([await read("Школа № 196 (неконкурентная закупка СМСП)", "Проект договора.doc")]), false);
  assert.equal(forbidsHidden([await read("Детские сады Семикаракорска (аукцион, питание)", "Приложение № 4 Проект контракта.docx")]), false);
});

test("предупреждение: есть запрет и есть скрытое — называем файл и что скрыто; нет запрета или нет скрытого — молчим", () => {
  const forbid = [{ name: "Документация.docx", text: "Применение в электронных документах скрытых листов, столбцов, строк, текста и тому подобного не допускается." }];
  const own = [{ name: "Расчёт.xlsx", hidden: ["лист «Себестоимость» скрыт", "на листе «Расчёт» скрыты строки: 2"] }, { name: "Чистый.docx" }];
  assert.equal(
    hiddenWarning(own, forbid),
    "Заказчик не допускает в файлах заявки скрытые листы, столбцы, строки и текст, а в них они есть: «Расчёт.xlsx» — лист «Себестоимость» скрыт; на листе «Расчёт» скрыты строки: 2. Покажите или удалите их."
  );
  assert.equal(hiddenWarning(own, [{ name: "ТЗ.docx", text: "Обычное требование без запретов" }]), null);
  assert.equal(hiddenWarning([{ name: "Чистый.docx" }], forbid), null);
});

test("запрет «скрытых листов, столбцов, строк, текста и т.п. не допускается» находится: точка в «т.п.» не обрывает фразу", () => {
  assert.equal(forbidsHidden([{ text: "Применение в электронных документах скрытых листов, столбцов, строк, текста и т.п. не допускается." }]), true);
  assert.equal(forbidsHidden([{ text: "Файл содержит листы, столбцы и строки; и т.п. допускается." }]), false);
});

test("Word: «w:vanish» в свойствах знака абзаца у пустых абзацев (Word ставит сам) — не скрытый текст; в куске с буквами — скрытый", async () => {
  const file = (xml: string) => new File([new Uint8Array(docx({ body: xml }))], "документация.docx");
  const empty = '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr></w:p>';
  const clean = await extractText(file(empty + para("<w:r><w:t>обычный текст</w:t></w:r>")), { ocr: false });
  assert.equal(clean.ok && clean.hidden, undefined, "пустой абзац со скрытым знаком абзаца — не повод тревожиться");
  const spaces = await extractText(file(para('<w:r><w:rPr><w:vanish/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>') + para("<w:r><w:t>текст</w:t></w:r>")), { ocr: false });
  assert.equal(spaces.ok && spaces.hidden, undefined, "скрытый пробел — тоже не текст");
  const real = await extractText(file(empty + para('<w:r><w:rPr><w:b/><w:vanish/></w:rPr><w:t xml:space="preserve">скрыто </w:t></w:r>')), { ocr: false });
  assert.deepEqual(real.ok && real.hidden, ["в тексте есть скрытый шрифт"]);
});
