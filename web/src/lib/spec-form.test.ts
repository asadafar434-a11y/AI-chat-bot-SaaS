// Бланки «Спецификация» и «Расчёт цены» с ценами участника: настоящие файлы школы № 196 и детских садов Семикаракорска — npm test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractText } from "./extract-text.ts";
import { readDocx } from "./docx-reader.ts";
import { blankRequest } from "./blank-request.ts";
import { columnKind, specificationForms } from "./spec-form.ts";
import { fileFromRequest } from "./tp-docx-request.ts";

const FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
async function read(dir: string, name: string) {
  const r = await extractText(new File([new Uint8Array(readFileSync(path.join(FOLDER, dir, name)))], name), { ocr: false });
  assert.ok(r.ok, name);
  return { name, text: r.text };
}
const SCHOOL = "Школа № 196 (неконкурентная закупка СМСП)";
const FOOD = "Детские сады Семикаракорска (аукцион, питание)";
const NMCD = 1_704_386.67;
const num = (text: string) => Number(text.replace(/\s/g, "").replace(",", "."));

async function schoolDocs() {
  return [await read(SCHOOL, "Проект договора.doc"), await read(SCHOOL, "НМЦК.xlsx")];
}

test("столбцы бланка узнаются по названию", () => {
  const kinds = ["№", "Наименование товара", "Ед. изм.", "Кол-во", "Цена за ед., руб. без НДС", "Сумма, руб. без НДС", "НДС, 5%", "Цена за ед., руб. с НДС", "Сумма, руб. с НДС"].map(columnKind);
  assert.deepEqual(kinds, ["index", "name", "unit", "qty", "unitNoVat", "sumNoVat", "vat", "unitVat", "sumVat"]);
  assert.deepEqual(["№ п/п", "Цена за ед., руб.", "Максимальное значение цены договора, руб.", "Стоимость"].map(columnKind), ["index", "unitPrice", "max", "sum"]);
});

test("школа: цена 1 650 000 ₽ и НДС 5 % — девять столбцов заполнены, сумма равна итогу, «без НДС + НДС = с НДС»", async () => {
  const [form] = specificationForms({ documents: await schoolDocs(), profile: { taxSystem: "УСН", vatNote: "в том числе НДС 5 %" }, nmck: NMCD, tpPrice: 1_650_000 });
  assert.equal(form.title, "СПЕЦИФИКАЦИЯ");
  assert.equal(form.fields.length, 0, "вписывать нечего");
  const rows = form.table!.slice(1, 5);
  assert.deepEqual(rows.map((r) => r[1]), ["МФУ", "Компьютер в комплекте, тип 1", "Компьютер в комплекте, тип 2", "Компьютер в комплекте, тип 3"]);
  for (const r of rows) {
    const [qty, withoutSum, vat, withSum] = [num(r[3]), num(r[5]), num(r[6]), num(r[8])];
    assert.ok(Math.abs(withoutSum + vat - withSum) < 0.005, r[1]);
    assert.ok(Math.abs(qty * num(r[7]) - withSum) < 0.005, `${r[1]}: цена с НДС × количество = сумма`);
  }
  const total = form.table!.at(-1)!;
  assert.equal(total[1], "ИТОГО:");
  assert.equal(total[8], "1 650 000,00");
  assert.equal(form.footer, "Всего: 1 650 000,00 руб., НДС: 78 571,43 руб.");
});

test("школа: цена равна НМЦД — сумма ровно 1 704 386,67 ₽ (наивное округление дало бы 1 704 386,68)", async () => {
  const [form] = specificationForms({ documents: await schoolDocs(), profile: { taxSystem: "УСН", vatNote: "в том числе НДС 5 %" }, nmck: NMCD, tpPrice: NMCD });
  assert.equal(form.table!.at(-1)![8], "1 704 386,67");
});

test("школа: режим налогообложения не известен — «с НДС» заполнено, «без НДС» и НДС жёлтые и считаются в полях бланка", async () => {
  const [form] = specificationForms({ documents: await schoolDocs(), profile: { taxSystem: "", vatNote: "" }, nmck: NMCD, tpPrice: NMCD });
  const first = form.table![1];
  assert.deepEqual([first[4], first[5], first[6]], ["[впишите]", "[впишите]", "[впишите]"]);
  assert.notEqual(first[7], "[впишите]");
  assert.equal(form.fields.length, 12);
  // «Без НДС» (УСН без НДС): колонка НДС — слова, суммы совпадают
  const [free] = specificationForms({ documents: await schoolDocs(), profile: { taxSystem: "УСН", vatNote: "НДС не облагается" }, nmck: NMCD, tpPrice: NMCD });
  assert.deepEqual([free.table![1][6], free.table![1][5] === free.table![1][8]], ["без НДС", true]);
  assert.match(free.footer ?? "", /НДС: не облагается\.$/);
});

test("школа: цена не поставлена или нет расчёта НМЦК — цены жёлтые, ничего не угадывается", async () => {
  const profile = { taxSystem: "УСН", vatNote: "НДС 5 %" };
  const [noPrice] = specificationForms({ documents: await schoolDocs(), profile, nmck: NMCD, tpPrice: null });
  assert.ok(noPrice.table!.slice(1, 5).every((r) => r[7] === "[впишите]" && r[8] === "[впишите]"));
  assert.equal(noPrice.footer, "Всего: [впишите], НДС: [впишите].");
  const [noBase] = specificationForms({ documents: [(await schoolDocs())[0]], profile, nmck: NMCD, tpPrice: 1_650_000 });
  assert.ok(noBase.table!.slice(1, 5).every((r) => r[7] === "[впишите]"));
});

test("детские сады: расчёт цены для каждого из девяти заказчиков — цены единиц на снижении 25 %: 129,75 и 150,00, максимум — свой у каждого", async () => {
  const documents = [await read(FOOD, "Приложение № 4 Проект контракта.docx"), await read(FOOD, "Обоснование максимальных значений цены.docx")];
  const [form] = specificationForms({ documents, profile: { taxSystem: "", vatNote: "" }, nmck: 17_000_000, tpPrice: 12_750_000 });
  assert.equal(form.title, "РАСЧЕТ ЦЕНЫ ОКАЗЫВАЕМЫХ УСЛУГ");
  assert.equal(form.table!.length, 1 + 9 * 3);
  assert.deepEqual(form.table![1].slice(0, 1), ["Для заказчика: «Родничок»"]);
  assert.deepEqual([form.table![2][4], form.table![3][4], form.table![2][5]], ["129,75", "150,00", "2 200 000,00"]);
  assert.equal(form.table!.at(-1)![5], "1 400 000,00");
  assert.equal(form.footer, undefined);
  // цена не поставлена — цены единиц жёлтые, максимумы заказчиков на месте
  const [blank] = specificationForms({ documents, profile: { taxSystem: "", vatNote: "" }, nmck: 17_000_000, tpPrice: null });
  assert.deepEqual([blank.table![2][4], blank.table![2][5]], ["[впишите]", "2 200 000,00"]);
});

test("закупка без бланка с ценами — бланков нет", async () => {
  assert.deepEqual(specificationForms({ documents: [await read(SCHOOL, "Извещение.doc")], profile: { taxSystem: "", vatNote: "" }, nmck: NMCD, tpPrice: 1 }), []);
});

test("файл Word из бланка: тот же путь, что у скачивания в «Пакете», — шапка, строки, итог и жёлтые места попадают в документ", async () => {
  const [form] = specificationForms({ documents: await schoolDocs(), profile: { taxSystem: "", vatNote: "" }, nmck: NMCD, tpPrice: 1_650_000 });
  const made = await fileFromRequest(blankRequest("Поставка МФУ и компьютеров", form), "docx");
  assert.ok(made.ok);
  if (!made.ok) return;
  assert.equal(made.name, "СПЕЦИФИКАЦИЯ");
  const text = readDocx(new Uint8Array(made.buffer)).text;
  assert.match(text, /№ \| Наименование товара \| Ед\. изм\. \| Кол-во \| Цена за ед\., руб\. без НДС/);
  assert.match(text, /1 \| МФУ \| шт \| 4 \|/);
  assert.match(text, /ИТОГО:/);
  assert.match(text, /Всего: 1 650 000,00 руб\., НДС: \[впишите\]\./);
  assert.match(text, /\[впишите\]/);
});
