// Резюме разбора: светофор с причинами, абзац, цифры, рекомендации и строки разделов — из уже посчитанного — npm test (без ИИ).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSummary as rawSummary, rubles, VERDICT_LABELS, type Summary, type SummaryInput } from "./analytics-summary.ts";
import { contractRisks } from "./contract-risks.ts";
import { DEFAULT_ECON, economics } from "./economics.ts";
import { regionNote } from "./hidden-costs.ts";
import { DEFAULT_ASSUMPTIONS, estimateRisks } from "./risk-estimate.ts";
import type { PriceCalc } from "./price-floor.ts";

// Суммы в резюме с неразрывными пробелами; в проверках сравниваем с обычными.
const plain = (s: string) => s.replace(/[  ]/g, " ");
const buildSummary = (i: SummaryInput): Summary => {
  const s = rawSummary(i);
  return {
    ...s,
    text: plain(s.text),
    verdict: { ...s.verdict, reasons: s.verdict.reasons.map(plain) },
    facts: s.facts.map((f) => ({ label: f.label, value: plain(f.value) })),
    recommendations: s.recommendations.map(plain),
    sections: s.sections.map((x) => ({ ...x, brief: plain(x.brief) })),
  };
};

const CALC: PriceCalc = {
  nmck: 1_000_000,
  costs: 700_000,
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
const LINES = [
  "7.3. Исполнитель обязан уплатить Заказчику пеню в размере 0,1% от цены Договора за каждый день просрочки.",
  "3.6. Оплата производится Заказчиком в течение 30 дней с даты акта.",
  "10.1. Договор заключается после предоставления Исполнителем обеспечения исполнения Договора в размере 5 % от цены.",
  "2.1. Цена Договора является твёрдой и определяется на весь срок исполнения Договора.",
  "5.12. Расходы на экспертизу несёт Исполнитель, за исключением случаев, когда экспертизой установлено отсутствие нарушений.",
];
function input(over: Partial<SummaryInput> = {}, calc: Partial<PriceCalc> = {}, lines: string[] = LINES): SummaryInput {
  const risks = contractRisks([{ name: "Проект.docx", text: ["Договор поставки № 1", ...lines].join("\n") }]);
  const estimate = estimateRisks({ price: 1_000_000, risks, type: "goods", region: null, assumptions: DEFAULT_ASSUMPTIONS });
  const econ = economics({ calc: { ...CALC, ...calc }, estimate, settings: DEFAULT_ECON, price: null });
  return { title: "Поставка угля", kind: "44-ФЗ · электронный аукцион", nmck: 1_000_000, priceNote: "начальная цена", hasContract: true, risks, estimate, econ, badge: null, calcs: [], region: null, ...over };
}

test("нет затрат — «мало данных»: причина и рекомендация ввести затраты, цены не называет", () => {
  const s = buildSummary(input({}, { costs: null }));
  assert.equal(s.verdict.level, "unknown");
  assert.equal(s.verdict.label, VERDICT_LABELS.unknown);
  assert.match(s.verdict.reasons[0], /Введите свои затраты/);
  assert.match(s.text, /Чтобы назвать цену, нужны ваши затраты/);
  // Просьба ввести затраты уже есть в итоге и в кнопке; в рекомендациях её не повторяем.
  assert.ok(!s.recommendations.some((r) => /Введите свои затраты/.test(r)));
  assert.equal(s.facts.some((f) => f.label === "Целевая цена"), false);
  assert.match(s.sections.find((x) => x.id === "economics")!.brief, /нужны ваши затраты/);
  assert.match(s.sections.find((x) => x.id === "chart")!.brief, /^риски до \d+,\d % цены; нужны ваши затраты$/);
});

test("убыток даже по начальной цене — «не стоит» с суммой убытка", () => {
  const s = buildSummary(input({}, { costs: 950_000 }));
  assert.equal(s.verdict.level, "stop");
  assert.match(s.verdict.reasons[0], /Даже по начальной цене \(1 000 000 ₽\) контракт убыточный/);
  assert.match(s.text, /убыточный даже по начальной цене|ниже/);
});

test("есть запас по цене, но договор с крупной неустойкой или стресс в убытке — «осторожно» с причинами", () => {
  const heavy = buildSummary(input({}, {}, [...LINES, "7.4. Исполнитель уплачивает Заказчику штраф в размере 30% от цены Договора."]));
  assert.equal(heavy.verdict.level, "careful");
  assert.ok(heavy.verdict.reasons.some((r) => /крупная неустойка: Штраф 30 %/.test(r)));
  const thin = buildSummary(input({}, { costs: 840_000 }));
  assert.equal(thin.verdict.level, "careful");
  assert.ok(thin.verdict.reasons.some((r) => /Целевая маржа недостижима даже по начальной цене: прибыль [\d ]+ ₽\. Ниже [\d ]+ ₽ — убыток/.test(r)));
  assert.ok(thin.verdict.reasons.some((r) => /В стрессовом сценарии при цене 1 000 000 ₽ — убыток/.test(r)));
});

test("спокойный контракт — «можно» с целевой и безопасной ценой", () => {
  const s = buildSummary(input({}, { costs: 500_000 }, ["3.6. Оплата производится Заказчиком в течение 10 дней с даты акта."]));
  assert.equal(s.verdict.level, "go");
  assert.match(s.verdict.reasons[0], /Целевая цена достижима \(\d{3} \d{3} ₽\)/);
  assert.match(s.text, /По вашим затратам целевая цена \d{3} \d{3} ₽/);
});

test("резюме: что за закупка, сколько условий в договоре и сколько требуют внимания, риски в рублях, целевая цена — одним абзацем", () => {
  const s = buildSummary(input());
  assert.match(s.text, /^Поставка угля\. 44-ФЗ · электронный аукцион; начальная цена 1 000 000 ₽\./);
  assert.match(s.text, /В договоре найдено условий с цифрами: \d+, внимания требуют \d+\./);
  assert.doesNotMatch(s.text, /Крупная неустойка/);
  const heavy = buildSummary(input({}, {}, [...LINES, "7.4. Исполнитель уплачивает Заказчику штраф в размере 30% от цены Договора."]));
  assert.match(heavy.text, /Крупная неустойка: Штраф 30 %/);
  assert.match(s.text, /Если сработают все оценённые риски — до [\d  ]+ ₽ \(\d+,\d %? ?цены\)/);
  assert.match(s.text, /По вашим затратам целевая цена/);
  assert.ok(!s.text.includes("\n"));
});

test("договора нет — так и сказано; договор без цифр — не значит, что рисков нет", () => {
  assert.match(buildSummary(input({ hasContract: false, risks: [] })).text, /Проект договора в документах не нашёл/);
  assert.match(buildSummary(input({ risks: [] })).text, /В договоре не нашёл условий с цифрами/);
  assert.match(buildSummary(input({ hasContract: false, risks: [] })).recommendations[0], /Загрузите проект договора/);
});

test("рекомендации по делу, не больше шести: запас по срокам, цена неизвестных расходов, деньги до оплаты, гарантия, твёрдая цена, регион", () => {
  const region = regionNote({ text: "Место поставки: г. Севастополь", region: { name: "Севастополь", hard: true } }, "г. Екатеринбург");
  const s = buildSummary(
    input({ region }, {}, [...LINES, "6.4. Исполнитель обязан уплатить Заказчику пеню в размере 5 % от цены Договора за каждый день просрочки.", "10.2. Обеспечение исполнения Договора в размере 30 % от цены."]),
  );
  assert.ok(s.recommendations.length <= 6);
  const joined = s.recommendations.join("\n");
  assert.match(joined, /Просрочка: пеня 5 % в день: до [\d ]+ ₽ \(\d+,\d % цены\) — заложите запас по срокам\./);
  // Штраф за нарушение — не про сроки: советуем проверить, за что он положен.
  const fine = buildSummary(input({}, {}, [...LINES, "7.4. Исполнитель уплачивает Заказчику штраф в размере 30% от цены Договора."]));
  assert.ok(fine.recommendations.some((r) => /^Штраф за нарушение условий: до [\d ]+ ₽ \(30,0 % цены\) — проверьте, за какие нарушения он положен\.$/.test(r)));
  assert.ok(!fine.recommendations.some((r) => /Штраф[^.]*заложите запас по срокам/.test(r)));
  assert.match(joined, /Запросите цену, в договоре и документах суммы нет: экспертиза/);
});

test("строки разделов для раскрывающихся заголовков: договор, оценка, цена, расчёт заказчика", () => {
  const s = buildSummary(input());
  const brief = (id: string) => s.sections.find((x) => x.id === id)!.brief;
  assert.match(brief("risks"), /\d+ условий, внимания требуют \d+/);
  assert.match(brief("estimate"), /^до [\d  ]+ ₽ · \d+,\d % цены$/);
  assert.match(brief("economics"), /^целевая [\d  ]+ ₽$/);
  assert.equal(brief("nmck"), "не найден");
  assert.equal(brief("ric"), "не заполнено");
  assert.match(brief("chart"), /^рентабельность \d+,\d % · риски до \d+,\d %$/);
  assert.deepEqual(s.sections.map((x) => x.id), ["risks", "estimate", "economics", "nmck", "ric", "chart"]);
});

test("суммы не рвутся на строки: пробелы внутри числа и перед «₽» и «%» неразрывные", () => {
  assert.equal(rubles(1_000_000), "1 000 000 ₽");
  assert.equal(rubles(-73_007), "−73 007 ₽");
  const s = rawSummary(input());
  assert.match(s.text, /начальная цена 1 000 000 ₽/);
  assert.match(s.text, /\d+,\d % цены/);
  assert.ok(!/\d \d{3}/.test(s.verdict.reasons.join(" ")));
});
