// Пересчёт формул Excel-бланка и итоги по ним: сверка с тем, что Excel записал в настоящие файлы заказчиков, и итоги после вписанных цен — npm test (без ИИ).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { EMPTY_PROFILE } from "./profile.ts";
import { Calc, isCalcError, totalsOf } from "./xlsx-calc.ts";
import { readBook, shiftFormula } from "./xlsx-form.ts";
import { planFill } from "./xlsx-plan.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
const bytesOf = (rel: string) => new Uint8Array(readFileSync(path.join(ROOT, rel)));
const DGK = "ДГК (конкурс 223-ФЗ, комплектующие дымососов)/Форма Коммерческого предложения и Структуры НМЦ.xlsx";
const USGS = "УСГС (аукцион МСП 223-ФЗ, новогодние подарки, итог)/Форма Коммерческого предложения и структуры НМЦ.xlsx";
const RVK = "РВК-Комсомольск (маркетинговое исследование 223-ФЗ, бухучёт)/Приложение № 6 (Форма 1) - Письмо оферта+КП.xlsx";
const ROS = "Россети Сибирь (закупка в электронном магазине, мебель)/СО 6.3140 Приложение Расчет стоимости.xlsx";
const KS = "Комфортная среда (конкурентный отбор 223-ФЗ, обследование и ПИР)/Расчет НМЦК (по рынку) на Обсл-е и ПСД  на ККР, Екб, Мостовая-57(v1).xlsx";
const CTO = "ГАУ ЦТО Москва (аукцион МСП 223-ФЗ, стенды для СПО)/Расчет НМЦД СПО-КР2027-36.xlsx";
const RVK_SHEET = "П.6 оферта+КП";

async function sheetCalc(build: (sheet: ExcelJS.Worksheet) => void) {
  const book = new ExcelJS.Workbook();
  build(book.addWorksheet("Лист1"));
  return new Calc(readBook(new Uint8Array(await book.xlsx.writeBuffer())));
}
const at = (calc: Calc, ref: string) => calc.cell("Лист1", ref).v;

test("пересчёт формул совпадает с результатами, которые Excel записал в настоящие бланки и расчёты НМЦ (SUM, IF, ROUND, AVERAGE, STDEV, MIN, общие формулы)", () => {
  for (const rel of [DGK, USGS, RVK, ROS, KS, CTO]) {
    const book = readBook(bytesOf(rel));
    const calc = new Calc(book);
    let checked = 0;
    for (const sheet of book.sheets) {
      for (const cell of sheet.cells.values()) {
        if (!cell.ftext || cell.kind === "s" || cell.text === "") continue;
        const got = calc.cell(sheet.name, cell.ref).v;
        assert.ok(!isCalcError(got), `${path.basename(rel)} ${sheet.name}!${cell.ref}: =${cell.ftext} — ${JSON.stringify(got)}`);
        const want = Number(cell.text);
        if (!Number.isFinite(want)) continue;
        assert.ok(typeof got === "number" && Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want)), `${path.basename(rel)} ${sheet.name}!${cell.ref}: =${cell.ftext} → ${got}, в файле ${want}`);
        checked++;
      }
    }
    assert.ok(checked >= 9, `${path.basename(rel)}: проверено формул ${checked}`);
  }
});

test("общие формулы: у ячеек-потомков текст пересчитан на их строку и столбец, «$» держит ссылку", () => {
  assert.equal(shiftFormula("$F17*G17", 1, 0), "$F18*G18");
  assert.equal(shiftFormula("SUM(H17:H44)*3", 2, 1), "SUM(I19:I46)*3");
  assert.equal(shiftFormula('IF(K15="да",$O$35,1)', 3, 5), 'IF(P18="да",$O$35,1)');
  assert.equal(shiftFormula('"A1"&B2', 1, 1), '"A1"&C3', "текст в кавычках не двигается");
  // Настоящий бланк ДГК записан общими формулами: у строки 34 текст формулы восстановлен.
  const sheet = readBook(bytesOf(DGK)).sheets[0];
  assert.equal(sheet.cells.get("N34")?.ftext, "L34*M34");
  assert.equal(sheet.cells.get("M34")?.ftext, 'IF(K34="да",$O$35,1)');
});

test("язык формул: порядок действий, проценты, степень, текст, сравнения, IF и IFERROR, ошибки", async () => {
  const calc = await sheetCalc((s) => {
    s.getCell("A1").value = 10;
    s.getCell("A2").value = { formula: "A1*2+3^2", result: 0 };
    s.getCell("A3").value = { formula: "-2^2", result: 0 };
    s.getCell("A4").value = { formula: "(A1+5)*2.56%", result: 0 };
    s.getCell("A5").value = { formula: 'IF(A1>5,"много","мало")&"!"', result: "" };
    s.getCell("A6").value = { formula: "A1/0", result: 0 };
    s.getCell("A7").value = { formula: "IFERROR(A1/0,-1)", result: 0 };
    s.getCell("A8").value = { formula: "ROUND(2.5,0)+ROUND(-2.5,0)+ROUNDUP(1.231,2)+ROUNDDOWN(1.239,2)", result: 0 };
    s.getCell("A9").value = { formula: 'AND(A1>1,A1<100,"а"="А")', result: 0 };
    s.getCell("A10").value = { formula: "FOO(1)", result: 0 };
    s.getCell("A11").value = { formula: "'[1]Лист'!A1+1", result: 0 };
    s.getCell("B1").value = 2;
    s.getCell("B2").value = 4;
    s.getCell("B3").value = { formula: "SUMPRODUCT(B1:B2,B1:B2)+MIN(B1:B2)+MAX(B1:B2)+COUNT(B1:B2)", result: 0 };
    s.getCell("C1").value = { formula: "C2", result: 0 };
    s.getCell("C2").value = { formula: "C1", result: 0 };
  });
  assert.equal(at(calc, "A2"), 29);
  assert.equal(at(calc, "A3"), 4, "в Excel −2^2 = 4");
  assert.ok(Math.abs((at(calc, "A4") as number) - 0.384) < 1e-12);
  assert.equal(at(calc, "A5"), "много!");
  assert.deepEqual(at(calc, "A6"), { error: "#DIV/0!" });
  assert.equal(at(calc, "A7"), -1);
  assert.equal(at(calc, "A8"), 3 - 3 + 1.24 + 1.23, "ROUND — от нуля, ROUNDUP — вверх, ROUNDDOWN — вниз");
  assert.equal(at(calc, "A9"), true);
  assert.deepEqual(at(calc, "A10"), { error: "#NAME?" }, "незнакомая функция — ошибка, а не выдуманное число");
  assert.deepEqual(at(calc, "A11"), { error: "#REF!" }, "ссылка на другую книгу — ошибка");
  assert.equal(at(calc, "B3"), 4 + 16 + 2 + 4 + 2);
  assert.deepEqual(at(calc, "C1"), { error: "#CIRC!" });
});

test("итоги после вписанных цен: тариф РВК — стоимость за три месяца, второй год с 1/2 ИПЦ и итог за срок договора считаются по формулам файла", () => {
  const book = readBook(bytesOf(RVK));
  const overrides = new Map<string, number | string>([
    [`${RVK_SHEET}!F17`, 1250.5],
    [`${RVK_SHEET}!F18`, 88.2],
  ]);
  const totals = totalsOf(book, overrides);
  const month = 1250.5 * 3472 + 88.2 * 106.5;
  const byRef = new Map(totals.map((t) => [t.ref, t]));
  assert.ok(Math.abs(byRef.get("H45")!.value - month * 3) < 1e-6, "H45 = SUM(H17:H44)*3");
  assert.ok(Math.abs(byRef.get("H46")!.value - month * 1.0256 * 12) < 1e-6, "H46 = ((H45/3)*(1+2,56%))*12");
  assert.ok(Math.abs(byRef.get("H47")!.value - (month * 3 + month * 1.0256 * 12)) < 1e-6, "H47 = SUM(H45:H46)");
  assert.match(byRef.get("H47")!.label, /Итого за срок действия договора/);
  assert.deepEqual(totalsOf(book, new Map()), [], "пока ничего не вписано — итогов нет");
});

test("итоги ДГК: коэффициент из цены даёт «Итого без НДС» ровно на цену участника, а итог заказчика (его НМЦ) не показывается", () => {
  const nmck = 59_103_088.52;
  const p = planFill(readBook(bytesOf(DGK)), { profile: EMPTY_PROFILE, subject: "", goods: [], price: { nmck, tpPrice: 50_000_000 } });
  const without = p.totals.find((t) => /Итого без НДС/.test(t.label));
  const withVat = p.totals.find((t) => /Итого с НДС/.test(t.label));
  assert.ok(without && withVat);
  assert.ok(Math.abs(without.value - 50_000_000) < 0.01, `итог ${without.value}`);
  assert.equal(without.samePrice, true);
  assert.equal(without.overNmck, false);
  assert.ok(Math.abs(withVat.value - 50_000_000 * 1.22) < 0.02);
  assert.equal(p.totals.some((t) => t.ref === "AD36"), false, "итог заказчика от вписанного не зависит");
});

test("итог выше начальной цены помечается; цена равна НМЦ — тоже «равна вашей цене»", () => {
  const nmck = 32_656_876.58;
  const book = readBook(bytesOf(RVK));
  const typed: Record<string, string> = Object.fromEntries(Array.from({ length: 28 }, (_, i) => [`${RVK_SHEET}!F${17 + i}`, "50000"]));
  const p = planFill(book, { profile: EMPTY_PROFILE, subject: "", goods: [], price: { nmck, tpPrice: 30_000_000, manual: typed } });
  const all = p.totals.find((t) => /Итого за срок действия договора/.test(t.label))!;
  assert.equal(all.overNmck, true, `итог ${all.value} выше ${nmck}`);
  assert.equal(all.samePrice, false);
});
