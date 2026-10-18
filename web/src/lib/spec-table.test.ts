// Бланк «Спецификация» и начальные цены за единицу из расчёта НМЦК: настоящие файлы школы № 196 и «Форумной дирекции» — npm test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractText } from "./extract-text.ts";
import { baseTotalKop, splitPrice, toKop } from "./price-split.ts";
import { baseUnitPrices, findSpecification } from "./spec-table.ts";
import { specNotes, vatRateOf } from "./spec-notes.ts";

const FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
async function read(dir: string, name: string) {
  const file = path.join(FOLDER, dir, name);
  const r = await extractText(new File([new Uint8Array(readFileSync(file))], name), { ocr: false });
  assert.ok(r.ok, name);
  return { name, text: r.text };
}
const SCHOOL = "Школа № 196 (неконкурентная закупка СМСП)";

test("школа № 196: бланк «Спецификация» из проекта договора (.doc) — четыре позиции, девять столбцов, НДС 5 %", async () => {
  const contract = await read(SCHOOL, "Проект договора.doc");
  const spec = findSpecification([contract]);
  assert.ok(spec);
  assert.equal(spec.title, "СПЕЦИФИКАЦИЯ");
  assert.deepEqual(spec.rows, [
    { name: "МФУ", unit: "шт", qty: 4 },
    { name: "Компьютер в комплекте, тип 1", unit: "шт", qty: 5 },
    { name: "Компьютер в комплекте, тип 2", unit: "шт", qty: 14 },
    { name: "Компьютер в комплекте, тип 3", unit: "шт", qty: 5 },
  ]);
  assert.deepEqual(spec.columns, [
    "№",
    "Наименование товара",
    "Ед. изм.",
    "Кол-во",
    "Цена за ед., руб. без НДС",
    "Сумма, руб. без НДС",
    "НДС, 5%",
    "Цена за ед., руб. с НДС",
    "Сумма, руб. с НДС",
  ]);
  assert.equal(spec.vatRate, 5);
  assert.equal(spec.hasPrice, true);
});

test("школа № 196: начальные цены за единицу — из расчёта НМЦК (последняя пара «цена — сумма»), и по ним сумма выше НМЦД на копейку", async () => {
  const contract = await read(SCHOOL, "Проект договора.doc");
  const nmck = await read(SCHOOL, "НМЦК.xlsx");
  const spec = findSpecification([contract])!;
  const base = baseUnitPrices(spec.rows, [contract, nmck])!;
  assert.deepEqual(base.map((x) => Math.round(x * 100) / 100), [21121.5, 70711.33, 66477.67, 67131.33]);
  const positions = spec.rows.map((r, i) => ({ name: r.name, qty: r.qty, baseKop: toKop(base[i]) }));
  assert.equal(baseTotalKop(positions), 170_438_668);
  assert.equal(splitPrice(positions, 170_438_667)!.shortKop, 0);
});

test("нет расчёта НМЦК с такими позициями — начальных цен нет, а не угаданные", async () => {
  const contract = await read(SCHOOL, "Проект договора.doc");
  const spec = findSpecification([contract])!;
  assert.equal(baseUnitPrices(spec.rows, [contract]), null);
  assert.equal(baseUnitPrices([{ name: "Чего-то нет", unit: "шт", qty: 1 }], [{ name: "x", text: "1 | Другое | шт | 1 | 10 | 10" }]), null);
});

test("таблица Word (.docx) — строки «а | б | в», номер впереди и условная единица («Форумная дирекция», расчёт цены)", () => {
  const text = [
    "Приложение № 2 к Договору",
    "РАСЧЕТ ЦЕНЫ ОКАЗЫВАЕМЫХ УСЛУГ",
    "(заполняется с учетом предложения победителя)",
    "№ п/п | Наименование услуги | Ед. Изм. | Кол-во | Цена за ед., руб. | Максимальное значение цены договора, руб.",
    "1 | Оказание услуги по организации питания воспитанников возраст 1,5-3 года | Условная единица | 1",
    "2 | Оказание услуги по организации питания воспитанников возраст 3-7 лет | Условная единица | 1",
    "",
    "Сноски",
  ].join("\n");
  const spec = findSpecification([{ name: "Проект контракта.docx", text }])!;
  assert.equal(spec.rows.length, 2);
  assert.deepEqual(spec.rows[0], { name: "Оказание услуги по организации питания воспитанников возраст 1,5-3 года", unit: "Условная единица", qty: 1 });
  assert.equal(spec.vatRate, null);
  assert.deepEqual(spec.columns.slice(0, 4), ["№ п/п", "Наименование услуги", "Ед. Изм.", "Кол-во"]);
});

test("не спецификация: слово в тексте, заголовок без таблицы и ИТОГО не берутся", () => {
  assert.equal(findSpecification([{ name: "а.docx", text: "Поставка по спецификации (приложение № 1).\nСПЕЦИФИКАЦИЯ\nТекст без таблицы" }]), null);
  const spec = findSpecification([
    { name: "б.docx", text: ["СПЕЦИФИКАЦИЯ", "№ | Наименование | Кол-во | Цена", "1 | Бумага А4 | 100", "ИТОГО: | 100", "Конец"].join("\n") },
  ])!;
  assert.deepEqual(spec.rows, [{ name: "Бумага А4", unit: "", qty: 100 }]);
});

// ——— Пометки на шаге «Цена» ———

test("пометки для школы № 196: бланк, ставка НДС 5 % против режима участника и копейка сверх НМЦД", async () => {
  const documents = [await read(SCHOOL, "Проект договора.doc"), await read(SCHOOL, "НМЦК.xlsx")];
  const none = { taxSystem: "", vatNote: "" };
  const notes = specNotes({ documents, profile: none, nmck: 1_704_386.67 });
  assert.equal(notes.length, 3);
  assert.match(notes[0], /бланк «СПЕЦИФИКАЦИЯ» на 4 позиции \(Проект договора\.doc\)/);
  assert.match(notes[1], /НДС 5 %: проверьте, подходит ли ваш режим/);
  assert.match(notes[2], /дают в сумме 1 704 386,68 ₽ — выше начальной цены 1 704 386,67 ₽/);

  // у участника тоже 5 % — про НДС молчим; другая ставка или без НДС — называем её
  assert.equal(specNotes({ documents, profile: { taxSystem: "УСН", vatNote: "в том числе НДС 5 %" }, nmck: 1_704_386.67 }).length, 2);
  assert.match(specNotes({ documents, profile: { taxSystem: "УСН", vatNote: "НДС не облагается в связи с применением УСН" }, nmck: 1_704_386.67 })[1], /а по вашим реквизитам — без НДС/);
  assert.match(specNotes({ documents, profile: { taxSystem: "ОСН", vatNote: "в том числе НДС 22 %" }, nmck: 1_704_386.67 })[1], /а по вашим реквизитам — 22 %/);
  // начальная цена закупки не известна — про копейку не говорим
  assert.equal(specNotes({ documents, profile: none, nmck: null }).length, 2);
});

test("нет бланка с ценами — нет и пометок; ставка НДС по реквизитам не угадывается", () => {
  assert.deepEqual(specNotes({ documents: [{ name: "а.docx", text: "Обычный текст закупки" }], profile: { taxSystem: "", vatNote: "" }, nmck: 100 }), []);
  assert.equal(vatRateOf({ taxSystem: "УСН", vatNote: "" }), null, "упрощёнка бывает и без НДС, и с 5 или 7 %");
  assert.equal(vatRateOf({ taxSystem: "", vatNote: "" }), null);
  assert.equal(vatRateOf({ taxSystem: "", vatNote: "НДС не облагается" }), 0);
  assert.equal(vatRateOf({ taxSystem: "", vatNote: "в том числе НДС по ставке 7%" }), 7);
});
