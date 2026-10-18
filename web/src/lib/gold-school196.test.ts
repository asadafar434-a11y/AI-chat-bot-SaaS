// Эталон «Школа № 196»: неконкурентная закупка среди СМСП (ПП № 1352, п. 20(1)). Настоящие файлы заказчика читает код продукта — npm test.
// Запросов к ИИ тут нет. Разбор — «Татьяна-Примеры документов/Школа № 196 (неконкурентная закупка СМСП)/РАЗБОР.md».
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractText } from "./extract-text.ts";
import { checkText, exactValuesNote } from "./requirement-engine.ts";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов/Школа № 196 (неконкурентная закупка СМСП)");

async function read(name: string): Promise<string> {
  const r = await extractText(new File([new Uint8Array(readFileSync(path.join(DIR, name)))], name), { ocr: false });
  assert.ok(r.ok, `${name} не прочитан`);
  return r.text;
}

test("извещение (.doc): способ, НМЦД и состав предварительного предложения читаются", async () => {
  const t = await read("Извещение.doc");
  assert.match(t, /Неконкурентная закупка, участниками которой могут быть только субъекты малого и среднего предпринимательства/);
  assert.match(t, /1704386,67/);
  assert.match(t, /предварительное предложение/);
  assert.match(t, /реестре недобросовестных поставщиков, предусмотренном\s+Федеральным законом № 44-ФЗ/);
  assert.ok(!/технического предложения|техническое предложение/i.test(t), "ТП в составе предложения не требуется");
});

test("срока окончания подачи в извещении нет: единственная дата — «Дата осуществления закупки»", async () => {
  const t = await read("Извещение.doc");
  assert.match(t, /Дата осуществления закупки\s+16\.10\.2026/);
  assert.ok(!/окончани\S+ (срока )?подачи/i.test(t));
});

test("договор (.doc): бланк «Спецификация» с колонкой «НДС, 5%» и пустыми ценами", async () => {
  const t = await read("Проект договора.doc");
  assert.match(t, /СПЕЦИФИКАЦИЯ/);
  assert.match(t, /НДС, 5%/);
  assert.match(t, /Компьютер в комплекте, тип 3\tшт\t5\n/, "название, единица и количество заполнены, цены нет");
  assert.match(t, /10 процентов цены Договора/);
});

test("описание объекта закупки: значения точные — «не менее», «не более» и «эквивалент» не встречаются", async () => {
  const t = await read("Приложение № 2 Описание объекта закупки.docx");
  assert.match(t, /Компьютер в комплекте, тип 1 \| штука \| 5/);
  assert.ok(!/не менее|не более|эквивалент/i.test(t));
});

test("НМЦК: сумма по позициям равна НМЦД из извещения, а цены за единицу с копейками дают на копейку больше", async () => {
  const t = await read("НМЦК.xlsx");
  const total = Number(/ИТОГО.*\|\s*([\d.,]+)\s*$/m.exec(t)?.[1].replace(",", "."));
  assert.equal(Math.round(total * 100), 170438667);
  const rows = [...t.matchAll(/^\d \| .*? \| шт \| (\d+) \|(?: [\d,]+ \|){6} ([\d,]+) \|/gm)];
  assert.equal(rows.length, 4);
  const rounded = rows.reduce((s, m) => s + Math.round(Number(m[2].replace(",", ".")) * 100) * Number(m[1]), 0);
  assert.equal(rounded, 170438668, "округлили цену за единицу до копеек — вышли за НМЦД на 1 копейку");
});

// Пункт 22 списка «Чего продукт пока не умеет»: абзацы ячейки с перечнем показателей отделены «; ».
test("показатели товара в одной ячейке отделены друг от друга", async () => {
  const t = await read("Приложение № 2 Описание объекта закупки.docx");
  assert.match(t, /Максимальный формат: A4; Цветность печати: черно-белая; Технология печати: лазерная/);
  const row = t.split("\n").find((l) => l.includes("Компьютер в комплекте, тип 1"))!;
  assert.ok(row.split("; ").length > 70, "около 90 показателей, каждый отделён");
  assert.match(row, /Системный блок: Блок питания: 450 Вт 80 Plus; Материнская плата: Сокет: LGA1700/, "заголовок группы с двоеточием не отрывается от первого показателя");
});

// Пункт 23: «значение точное» — пометка у показателя товара, в котором заказчик не написал границу.
test("точное значение: у показателя без «не менее» и «эквивалента» есть пометка, у остальных — нет", async () => {
  const t = await read("Приложение № 2 Описание объекта закупки.docx");
  assert.ok(!/не менее|не более|эквивалент/i.test(t), "в ТЗ школы границ нет совсем");
  const mark = (quote: string, type: "product" | "service" = "product") => exactValuesNote({ quote, type, numbers: [] });
  assert.match(mark("Частота процессора: 3300 MHz") ?? "", /Значение точное/);
  assert.match(mark("Максимальное разрешение для ч/б печати: 1200x1200 dpi") ?? "", /должен совпасть/);
  assert.equal(mark("Плотность бумаги: 60-163 г/м2"), null, "диапазон — не точное значение");
  assert.equal(mark("Объём памяти: не менее 128 Мб"), null);
  assert.equal(mark("Процессор: Intel Core i3 или эквивалент"), null);
  assert.equal(mark("Цвет: чёрный"), null, "без числа не берём");
  assert.equal(mark("Частота процессора: 3300 MHz", "service"), null, "только для товара");
});

test("точное значение показано в строке «Как проверить», рядом с остальным текстом", () => {
  const text = checkText({ check: "Сверить с карточкой модели", numbers: [], evidence: [], quote: "Частота процессора: 3300 MHz", type: "product" });
  assert.equal(text, "Сверить с карточкой модели. Значение точное: слов «не менее», «не более» и «или эквивалент» нет — предложенный товар должен совпасть с ним");
  assert.equal(checkText({ check: "Сверить с карточкой модели", numbers: [], evidence: [] }), "Сверить с карточкой модели");
});
