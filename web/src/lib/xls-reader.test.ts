// Старый Excel (.xls, BIFF8) без библиотек: читается так же, как тот же файл, сохранённый самим Excel в .xlsx — npm test.
// Файлы tests/fixtures/excel/features.xls и features.xlsx сделаны в Excel (одна книга, два формата): общая таблица строк на 400 записей (она занимает
// несколько записей CONTINUE), текст в 12 тысяч знаков, русские и латинские строки, числа разного вида, даты в четырёх форматах, формулы (число, текст,
// «да»), объединённая ячейка, скрытые лист, «очень скрытый» лист, строка и столбец.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractText } from "./extract-text.ts";
import { xlsText } from "./xls-reader.ts";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/excel");
const bytes = (name: string) => readFileSync(path.join(DIR, name));
const asFile = (name: string) => new File([new Uint8Array(bytes(name))], name);

test("тот же файл в .xls и в .xlsx читается одинаково: текст, список скрытого и число адресов ячеек", async () => {
  const xls = await extractText(asFile("features.xls"), { ocr: false });
  const xlsx = await extractText(asFile("features.xlsx"), { ocr: false });
  assert.ok(xls.ok && xlsx.ok);
  if (!xls.ok || !xlsx.ok) return;
  assert.equal(xls.text, xlsx.text);
  assert.deepEqual(xls.hidden, xlsx.hidden);
  assert.equal(xls.map?.spans.length, xlsx.map?.spans.length);
  assert.ok((xls.map?.spans.length ?? 0) > 800);
});

test("числа, даты, формулы и строки: русские и латинские, длинный текст, общая таблица строк в нескольких записях", () => {
  const { text, hidden } = xlsText(bytes("features.xls"));
  const lines = text.split("\n");
  assert.equal(lines[0], "## Лист «Данные»");
  assert.equal(lines[1], "Наименование | Кол-во | Цена | Дата | Сумма | Скрытый столбец");
  // дата в формате ДД.ММ.ГГГГ, десятичные, отрицательное, большое число, формула «количество × цена»
  assert.equal(lines[2], "Бумага офисная А4 | 3 | 125,5 | 09.12.2025 | 376,5 | секрет 2");
  assert.equal(lines[3], "Paper A4 (latin only) | 6 | 0,1 | 08.01.2026 | 0,6 | секрет 3");
  assert.equal(lines[5], "Папка-регистратор | 12 | -15,5 | 10.03.2026 | -186 | секрет 5");
  assert.equal(lines[6], "Степлер №24/6 | 15 | 1000000000000 | 10.04.2026 | 15000000000000 | секрет 6");
  // формулы: текст и логическое значение; подряд идущие целые (запись MULRK); объединённая ячейка
  assert.equal(lines[7], "Бумага офисная А4 шт. | да");
  assert.equal(lines[8], "7 | 14 | 21 | 28 | 35 | 42 | 49 | 56 | 63 | 70");
  assert.equal(lines[9], "Объединённая ячейка");
  assert.ok(lines[10].startsWith("Очень длинный текст Очень длинный текст") && lines[10].length > 11_900, "текст в 12 тысяч знаков цел");
  // 400 разных строк на двух языках — ни одна не потеряна на стыках записей
  assert.equal(lines.at(-1), "Позиция номер 400 — уникальная строка для общей таблицы строк, чтобы она разрослась | Item 400 unique latin string " + "x".repeat(40));
  for (let i = 1; i <= 400; i++) assert.ok(text.includes(`Позиция номер ${i} — `) && text.includes(`Item ${i} unique latin`), `строка ${i}`);
  assert.deepEqual(hidden, ["на листе «Данные» скрыты строки: 1", "на листе «Данные» скрыты столбцы: 1", "лист «Скрытый лист» скрыт", "лист «Очень скрытый» скрыт"]);
});

test("скрытые лист, «очень скрытый» лист, строка и столбец не попадают в текст и называются в списке скрытого", async () => {
  const { text } = xlsText(bytes("features.xls"));
  assert.ok(!text.includes("тайные данные") && !text.includes("совсем тайные"));
  const r = await extractText(asFile("features.xls"), { ocr: false });
  assert.ok(r.ok && r.hidden && r.hidden.length === 4);
});

test("не Excel, обрубок файла и чужой формат — понятная причина, а не падение", async () => {
  assert.throws(() => xlsText(Buffer.from("это просто текст")), /не файл Excel/);
  assert.throws(() => xlsText(bytes("features.xls").subarray(0, 3000)), /повреждённый файл/);
  const broken = await extractText(new File([new Uint8Array(bytes("features.xls").subarray(0, 3000))], "обрубок.xls"), { ocr: false });
  assert.deepEqual(broken, { ok: false, reason: "повреждённый файл — пересохраните файл как .xlsx" });
  const word = await extractText(new File([new Uint8Array(bytes("features.xlsx"))], "переименован.xls"), { ocr: false });
  assert.equal(word.ok, false, "настоящий .xlsx под именем .xls — не OLE: честный отказ");
});
