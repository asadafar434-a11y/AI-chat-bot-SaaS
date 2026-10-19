// Расхождения в цене внутри документов заказчика — npm test (без ИИ).
import assert from "node:assert/strict";
import { test } from "node:test";
import { priceDiscrepancies } from "./doc-discrepancies.ts";

const flat = (list: string[]) => list.map((s) => s.replace(/\s/g, " "));
const calc = (rowValue: string, net: string, vat: string, total: string, unit = "тыс. руб.") => [
  {
    name: "Расчёт НМЦД.xls",
    text: [
      `№ п.п. | Основание | Наименование работ | Стоимость, ${unit}`,
      "1 | 2 | 3 | 4",
      `1 | ЛС-1 | Ремонт | ${rowValue}`,
      `Итого без НДС: |  |  | ${net}`,
      `НДС (22%) |  |  | ${vat}`,
      `Стоимость с учетом НДС |  |  | ${total}`,
    ].join("\n"),
  },
];

test("расчёт сходится — молчим", () => {
  assert.deepEqual(priceDiscrepancies(calc("1000", "1000", "220", "1220", "руб."), 1220), []);
});

test("строки расчёта не равны «Итого без НДС» — разница названа, а «тыс. руб.» при числах в рублях замечено", () => {
  const notes = flat(priceDiscrepancies(calc("1000,0", "1001,0", "220,22", "1221,22"), 1221.22));
  assert.deepEqual(notes, [
    "«Расчёт НМЦД.xls»: строки расчёта дают 1 000,00 ₽, а «Итого без НДС» — 1 001,00 ₽ (разница 1,00 ₽)",
    "«Расчёт НМЦД.xls»: столбец назван «тыс. руб.», а числа в нём — в рублях (итог совпадает с начальной ценой в рублях)",
  ]);
});

test("итог расчёта не равен начальной цене из извещения; НДС и сумма не сходятся", () => {
  const notes = flat(priceDiscrepancies(calc("1000", "1000", "200", "1250", "руб."), 1300));
  assert.equal(notes.length, 3);
  assert.match(notes[0], /итог расчёта 1 250,00 ₽, а начальная цена в извещении — 1 300,00 ₽/);
  assert.match(notes[1], /НДС 22 % от 1 000,00 ₽ — 220,00 ₽, а в расчёте 200,00 ₽/);
  assert.match(notes[2], /«Итого без НДС» и НДС дают 1 200,00 ₽, а итоговая сумма — 1 250,00 ₽/);
});

test("документ без расчёта и копейка в пределах округления — молчим", () => {
  assert.deepEqual(priceDiscrepancies([{ name: "ТЗ.docx", text: "Описание работ без цен." }], 1000), []);
  assert.deepEqual(priceDiscrepancies(calc("1000,004", "1000", "220", "1220,004", "руб."), 1220), []);
});
