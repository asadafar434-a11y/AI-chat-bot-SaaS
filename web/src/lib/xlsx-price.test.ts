// Цены в Excel-бланке заказчика: коэффициент одной ячейкой (ДГК), раскладка по позициям с начальными ценами (УСГС), ввод цены за единицу без начальных цен
// (тариф РВК, ведомость объёмов) — npm test (без ИИ).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { EMPTY_PROFILE } from "./profile.ts";
import { applyEdits, readBook } from "./xlsx-form.ts";
import { planFill, type FillPlan } from "./xlsx-plan.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
const bytesOf = (rel: string) => new Uint8Array(readFileSync(path.join(ROOT, rel)));
const DGK = "ДГК (конкурс 223-ФЗ, комплектующие дымососов)/Форма Коммерческого предложения и Структуры НМЦ.xlsx";
const USGS = "УСГС (аукцион МСП 223-ФЗ, новогодние подарки, итог)/Форма Коммерческого предложения и структуры НМЦ.xlsx";
const RVK = "РВК-Комсомольск (маркетинговое исследование 223-ФЗ, бухучёт)/Приложение № 6 (Форма 1) - Письмо оферта+КП.xlsx";
const VV = "Воздушные Ворота СС (СМР, склад жидкости, тома проекта)/Приложение___5_к_Документации_о_закупке__Разбивка_стоимости_.xlsx";

const plan = (rel: string, nmck: number | null, tpPrice: number | null | undefined, manual?: Record<string, string>): FillPlan =>
  planFill(readBook(bytesOf(rel)), { profile: EMPTY_PROFILE, subject: "", goods: [], price: { nmck, tpPrice, manual } });
const prices = (p: FillPlan) => p.filled.filter((f) => f.kind === "price");
const value = (p: FillPlan, ref: string) => p.edits.find((e) => e.ref === ref)?.value;

async function workbook(build: (sheet: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  build(book.addWorksheet("Бланк"));
  return new Uint8Array(await book.xlsx.writeBuffer());
}

test("ДГК: «Понижающий коэффициент (К)» одной ячейкой = цена участника ÷ НМЦ; формулы и цены заказчика не трогаются", () => {
  const p = plan(DGK, 59_103_088.52, 50_000_000);
  assert.equal(prices(p).length, 1);
  const k = value(p, "O35") as number;
  assert.ok(Math.abs(k - 50_000_000 / 59_103_088.52) < 1e-11);
  assert.ok(Math.abs(k * 59_103_088.52 - 50_000_000) < 0.001, "итог по коэффициенту равен цене с точностью до долей копейки");
  assert.match(prices(p)[0].label, /Понижающий коэффициент \(К\) = цена 50 000 000,00 ÷ НМЦ 59 103 088,52/);
  assert.ok(!p.edits.some((e) => ["L15", "M15", "N15", "O15"].includes(e.ref)));
  const out = readBook(applyEdits(readBook(bytesOf(DGK)), p.edits));
  assert.equal(Number(out.sheets[0].cells.get("O35")?.text), k);
  assert.equal(out.sheets[0].cells.get("M15")?.formula, true, "формула М15 (если К — «да», берётся $O$35) на месте");
});

test("ДГК: цены нет, цена выше начальной или НМЦ в форме не та, что в закупке — коэффициент не пишем и говорим почему", () => {
  assert.match(plan(DGK, 59_103_088.52, null).left.join("\n"), /выберите цену на шаге «Цена»: коэффициент считается из неё/);
  assert.match(plan(DGK, 59_103_088.52, 60_000_000).left.join("\n"), /ваша цена выше начальной/);
  const other = plan(DGK, 72_105_767.99, 60_000_000);
  assert.equal(value(other, "O35"), undefined);
  assert.match(other.left.join("\n"), /НМЦ в форме \(59 103 088,52 ₽\) не совпала с НМЦ закупки \(72 105 767,99 ₽\)/);
});

test("УСГС: цена раскладывается по позициям пропорционально начальным, каждая не выше начальной; цена = НМЦ даёт начальные цены", () => {
  const whole = plan(USGS, 8_215_320, 8_215_320);
  assert.deepEqual(["L16", "L17", "L18", "L19", "L20", "L21"].map((r) => value(whole, r)), [193, 219, 1084, 824, 450, 914]);
  const cut = plan(USGS, 8_215_320, 7_500_000);
  const units = ["L16", "L17", "L18", "L19", "L20", "L21"].map((r) => value(cut, r) as number);
  const bases = [193, 219, 1084, 824, 450, 914];
  units.forEach((u, i) => assert.ok(u > 0 && u <= bases[i], `позиция ${i + 1}: ${u} не выше ${bases[i]}`));
  const total = Math.round(units.reduce((s, u) => s + u * 2230, 0) * 100);
  assert.ok(total <= 750_000_000 && 750_000_000 - total < 2230, "сумма не выше цены и ближе к ней, чем на копейку за единицу");
  assert.match(cut.left.join("\n"), /На площадке укажите 7 499 980,60 ₽/, "если точно не набрать — сказано, какую сумму называть на площадке");
  assert.ok(!whole.left.some((l) => /набралось/.test(l)));
  assert.match(prices(cut)[0].label, /Внешняя упаковка — цена за единицу \(НМЦ 193,00\)/);
});

test("раскладка по позициям: любая цена набирается точно, когда количества мелкие; цена выше начальной и без цены — не раскладываем", async () => {
  const bytes = await workbook((sheet) => {
    sheet.addRow(["№", "Наименование", "Количество", "НМЦ единицы, руб.", "Предлагаемая цена одной единицы, руб."]);
    sheet.addRow([1, "Стул", 3, 1000.5, null]);
    sheet.addRow([2, "Стол", 1, 5000, null]);
    sheet.addRow([3, "Шкаф", 2, 7000.25, null]);
  });
  const run = (nmck: number | null, tp: number | null) => planFill(readBook(bytes), { profile: EMPTY_PROFILE, subject: "", goods: [], price: { nmck, tpPrice: tp } });
  const nmck = 3 * 1000.5 + 5000 + 2 * 7000.25;
  const exact = run(nmck, 20_000);
  const sum = (exact.edits as { value: number }[]).reduce((s, e, i) => s + e.value * [3, 1, 2][i], 0);
  assert.equal(Math.round(sum * 100), 2_000_000, "20 000 ₽ набраны до копейки");
  assert.match(run(nmck, nmck + 1).left.join(" "), /выше начальной/);
  assert.match(run(nmck, null).left.join(" "), /выберите цену на шаге «Цена»/);
  assert.equal(run(null, 20_000).edits.length, 0);
});

test("РВК: тариф «цена за 1 ед. драйвера» — 28 строк на ввод (объём в графе «Объём», а не в «Методе подсчёта объёма»); введённое вписывается, формулы итогов остаются", () => {
  const empty = plan(RVK, 32_656_876.58, 30_000_000);
  assert.equal(empty.manual.length, 28);
  assert.deepEqual([empty.manual[0].ref, empty.manual[0].qty, empty.manual[2].qty], ["F17", 3472, 47451.75]);
  assert.match(empty.manual[0].name, /^Оказание услуг по учету основных средств/, "название — из графы «Наименование услуги», без чужих приставок");
  assert.equal(empty.edits.filter((e) => e.ref.startsWith("F")).length, 0, "без ввода участника цены не выдумываются");
  assert.match(empty.left.join("\n"), /ещё 28 из 28 строк/);

  const typed = plan(RVK, 32_656_876.58, 30_000_000, { "П.6 оферта+КП!F17": "1 250,50", "П.6 оферта+КП!F18": "ноль", "П.6 оферта+КП!F19": "0" });
  assert.equal(value(typed, "F17"), 1250.5);
  assert.equal(value(typed, "F19"), 0);
  assert.equal(value(typed, "F18"), undefined, "не число — не вписываем");
  assert.match(typed.left.join("\n"), /ещё 26 из 28 строк/);
  const out = readBook(applyEdits(readBook(bytesOf(RVK)), typed.edits));
  assert.equal(out.sheets[0].cells.get("F17")?.text, "1250.5");
  assert.equal(out.sheets[0].cells.get("H17")?.formula, true, "стоимость в месяц (=$F17*G17) остаётся формулой");
  assert.equal(out.sheets[0].cells.get("H45")?.formula, true);
});

test("ведомость объёмов: цены работ и материалов — отдельные графы, строки подписаны «Работы:» и «Материалы:»", () => {
  const p = plan(VV, 10_000_000, 9_000_000);
  assert.equal(p.manual.length, 138);
  assert.equal(p.manual.filter((m) => m.name.startsWith("Работы: ")).length, 69);
  assert.equal(p.manual.filter((m) => m.name.startsWith("Материалы: ")).length, 69);
  assert.deepEqual([p.manual[0].ref, p.manual[0].qty], ["G12", 3]);
  assert.match(p.manual[0].name, /^Работы: Вынос металлических контейнеров/);
});

test("без цен в закупке бланки без граф цены работают как раньше: реквизиты вписываются, цены не трогаются", () => {
  const book = readBook(bytesOf(RVK));
  const withoutPrice = planFill(book, { profile: { ...EMPTY_PROFILE, fullName: "ООО «Пример»" }, subject: "", goods: [] });
  assert.equal(withoutPrice.manual.length, 0);
  assert.ok(withoutPrice.filled.every((f) => f.kind !== "price"));
});
