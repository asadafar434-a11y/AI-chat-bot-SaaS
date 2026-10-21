// Отчёт по разбору закупки: состав разделов, честные «не найдено», печатный вид и настоящий Word (читаем обратно) — npm test (без ИИ).
import assert from "node:assert/strict";
import { test } from "node:test";
import mammoth from "mammoth";
import { assumptionLines, buildReport, reportFileName, reportHtml, REPORT_FOOTER, type ReportInput } from "./analytics-report.ts";
import { reportDocx } from "./analytics-report-docx.ts";
import { buildSummary } from "./analytics-summary.ts";
import { contractRisks } from "./contract-risks.ts";
import { DEFAULT_ECON, economics } from "./economics.ts";
import { computeRic, DEFAULT_SETTINGS, EMPTY_RIC, type RicData } from "./indicative-price.ts";
import { priceBadge } from "./price-badge.ts";
import type { PriceCalc } from "./price-floor.ts";
import { DEFAULT_ASSUMPTIONS, estimateRisks } from "./risk-estimate.ts";

const NOW = new Date("2026-10-21T12:00:00Z");
const CALC: PriceCalc = {
  nmck: 1_000_000,
  costs: 600_000,
  extra: 10_000,
  taxPct: 6,
  securityPct: 5,
  smeOnly: false,
  exempt: false,
  method: "guarantee",
  guaranteeRatePct: null,
  moneyRatePct: null,
  days: null,
  antiDumping: false,
  goodFaith: false,
  price: null,
};
const CONTRACT = [
  "Договор поставки № 1",
  "7.3. Исполнитель обязан уплатить Заказчику пеню в размере 0,1% от цены Договора за каждый день просрочки.",
  "3.6. Оплата производится Заказчиком в течение 30 дней с даты акта.",
  "5.12. Расходы на экспертизу несёт Исполнитель, за исключением случаев, когда экспертизой установлено отсутствие нарушений.",
].join("\n");

function input(over: Partial<ReportInput> = {}, ricData: RicData = EMPTY_RIC): ReportInput {
  const risks = contractRisks([{ name: "Проект договора.docx", text: CONTRACT }]);
  const estimate = estimateRisks({ price: 1_000_000, risks, type: "goods", region: null, assumptions: DEFAULT_ASSUMPTIONS });
  const econ = economics({ calc: CALC, estimate, settings: DEFAULT_ECON, price: null });
  const ric = computeRic(ricData, 1_000_000, NOW);
  const badge = priceBadge(ric, ricData);
  const summary = buildSummary({ title: "Поставка угля", kind: "44-ФЗ", nmck: 1_000_000, priceNote: "начальная цена", hasContract: true, risks, estimate, econ, badge, calcs: [], region: null });
  return {
    title: "Поставка угля",
    subtitle: "МУП «Тепло» · 44-ФЗ",
    date: NOW,
    summary,
    hasContract: true,
    risks,
    estimate,
    econ,
    calcs: [],
    ric,
    badge,
    assumptions: ["Ключевая ставка 14 %", "Просрочка 10 дней"],
    ...over,
  };
}

test("отчёт: шесть разделов в порядке экрана, итог и подвал с оговоркой", () => {
  const r = buildReport(input());
  assert.deepEqual(
    r.sections.map((s) => s.title),
    ["Резюме", "Риски и расходы из договора", "Сколько это может стоить по контракту", "Какую цену ставить", "Расчёт цены у заказчика", "РИЦ: расчёт индикативной цены"],
  );
  assert.equal(r.verdict.label, "Участвовать можно");
  assert.equal(r.footer, REPORT_FOOTER);
  assert.match(r.footer, /Юридическое заключение отчёт не заменяет/);
  assert.equal(r.date, "21 октября 2026 г.");
});

test("договор: каждое условие с группой, пунктом, файлом и цитатой; кто платит — вы или заказчик", () => {
  const r = buildReport(input());
  const t = r.sections[1].blocks.find((b) => b.type === "table");
  assert.ok(t && t.type === "table");
  assert.deepEqual(t.head, ["Условие", "Группа", "Кто", "Пункт", "Цитата"]);
  const penalty = t.rows.find((row) => row[1] === "Неустойка");
  assert.ok(penalty);
  assert.equal(penalty[2], "вы");
  assert.match(penalty[3], /^п\. 7\.3, Проект договора\.docx$/);
  assert.match(penalty[4], /^«Исполнитель обязан уплатить Заказчику пеню/);
  assert.ok(t.rows.some((row) => row[1] === "Расходы за ваш счёт"));
});

test("оценка: суммы с долей цены, расходы без суммы — «не определено» с тем, что запросить; допущения и итог", () => {
  const r = buildReport(input());
  const blocks = r.sections[2].blocks;
  const t = blocks.find((b) => b.type === "table");
  assert.ok(t && t.type === "table");
  assert.ok(t.rows.some((row) => /₽/.test(row[2]) && /%/.test(row[3])));
  assert.ok(t.rows.some((row) => /^не определено: /.test(row[2])));
  assert.ok(blocks.some((b) => b.type === "p" && /^Если сработают все оценённые риски: до [\d\s]+₽ \(\d+,\d\s%/.test(b.text)));
  assert.ok(blocks.some((b) => b.type === "bullets" && b.items.includes("Ключевая ставка 14 %")));
});

test("допущения словами: каждое — с числом из настроек", () => {
  const lines = assumptionLines(DEFAULT_ASSUMPTIONS);
  assert.equal(lines.length, 8);
  assert.equal(lines[0], "Стоимость денег: 14,0 % годовых");
  assert.ok(lines.includes("Просрочка по вашей вине: 10 дн."));
  assert.ok(lines.some((l) => /^Целевая маржа: 10,0 %; в оптимистичном сценарии затраты ниже на 5,0 %$/.test(l)));
  assert.match(assumptionLines({ ...DEFAULT_ASSUMPTIONS, delayDays: 30, growthPct: 7.5 }).join("\n"), /Просрочка по вашей вине: 30 дн\.[\s\S]*Рост затрат за срок контракта: 7,5 %/);
});

test("цена: три цены, три сценария и таблица снижения", () => {
  const r = buildReport(input());
  const tables = r.sections[3].blocks.filter((b) => b.type === "table");
  assert.equal(tables.length, 3);
  assert.deepEqual(tables[0].type === "table" && tables[0].rows.map((row) => row[0]), ["Не ниже", "Безопасная", "Целевая"]);
  assert.deepEqual(tables[1].type === "table" && tables[1].rows.map((row) => row[0]), ["Оптимистичный", "Базовый", "Стрессовый"]);
  assert.ok(tables[2].type === "table" && tables[2].rows.length >= 3);
});

test("нечего показать — так и написано, цифр не выдумываем: нет договора, нет затрат, нет расчёта заказчика, нет аналогов", () => {
  const noCosts = economics({ calc: { ...CALC, costs: null }, estimate: input().estimate, settings: DEFAULT_ECON, price: null });
  const r = buildReport(input({ hasContract: false, risks: [], econ: noCosts }));
  const text = (i: number) => r.sections[i].blocks.map((b) => (b.type === "p" ? b.text : "")).join(" ");
  assert.match(text(1), /Проект договора в документах не найден/);
  assert.match(text(3), /Не введены затраты на исполнение/);
  assert.match(text(4), /не найден расчёт начальной цены/);
  assert.match(text(5), /Цены-аналоги не введены/);
});

test("РИЦ с аналогами: показаны индикативная цена, диапазон и вывод по цене", () => {
  const analog = (id: string, price: string) => ({ id, price, vat: "without" as const, source: "Прайс поставщика", date: "2026-10-01" });
  const data: RicData = {
    positions: [{ id: "1", name: "Уголь", unit: "т", qty: "100", analogs: [analog("a", "9000"), analog("b", "9500"), analog("c", "10000"), analog("d", "9800"), analog("e", "9700")] }],
    settings: { ...DEFAULT_SETTINGS, nmckVat: "without" },
  };
  const r = buildReport(input({}, data));
  const t = r.sections[5].blocks.find((b) => b.type === "table");
  assert.ok(t && t.type === "table");
  const labels = t.rows.map((row) => row[0]);
  assert.ok(labels.includes("Индикативная цена закупки"));
  assert.ok(labels.includes("Диапазон по крайним аналогам"));
});

test("печатный вид: экранирует разметку из документов заказчика, не тянет внешних файлов, называет итог", () => {
  const r = buildReport(input({ title: "Закупка <script>alert(1)</script> & «К»" }));
  const html = reportHtml(r);
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; «К»/);
  assert.ok(!/(?:src|href)=["']https?:/.test(html));
  assert.match(html, /<div class="verdict">Участвовать можно<\/div>/);
  assert.match(html, /<h2>Риски и расходы из договора<\/h2>/);
});

test("имя файла без запрещённых знаков и не длиннее разумного", () => {
  const r = buildReport(input({ title: 'Поставка: уголь/ "марка" <Д>' + " х".repeat(80) }));
  const name = reportFileName(r, "docx");
  assert.ok(!/[\\/:*?"<>|]/.test(name.replace(/\.docx$/, "")));
  assert.match(name, /^Разбор закупки — Поставка уголь марка Д/);
  assert.ok(name.endsWith(".docx"));
  assert.ok(name.length < 120);
});

test("Word: настоящий файл, внутри резюме, таблица договора с цитатой и подвал", async () => {
  const blob = await reportDocx(buildReport(input()));
  assert.ok(blob.size > 4000);
  const text = (await mammoth.extractRawText({ buffer: Buffer.from(await blob.arrayBuffer()) })).value;
  assert.match(text, /Разбор закупки/);
  assert.match(text, /Участвовать можно/);
  assert.match(text, /Риски и расходы из договора/);
  assert.match(text, /Исполнитель обязан уплатить Заказчику пеню/);
  assert.match(text, /Какую цену ставить/);
  assert.match(text, /Юридическое заключение отчёт не заменяет/);
});
