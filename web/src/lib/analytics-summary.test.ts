// Резюме разбора: светофор с причинами, абзац, цифры, рекомендации и строки разделов — из уже посчитанного — npm test (без ИИ).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSummary as rawSummary, findingsOf, rubles, searchFinding, VERDICT_LABELS, type Summary, type SummaryInput } from "./analytics-summary.ts";
import { buildMatrix, summarize } from "./check-matrix.ts";
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
    facts: s.facts.map((f) => ({ ...f, value: plain(f.value) })),
    headline: s.headline && { ...s.headline, value: plain(s.headline.value), note: s.headline.note && plain(s.headline.note), extras: s.headline.extras.map((x) => ({ ...x, value: plain(x.value) })) },
    topRisks: s.topRisks.map((r) => ({ ...r, amount: plain(r.amount), pct: plain(r.pct) })),
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
  assert.deepEqual(s.sections.map((x) => x.id), ["risks", "estimate", "economics", "nmck", "ric", "matrix", "chart"]);
});

test("суммы не рвутся на строки: пробелы внутри числа и перед «₽» и «%» неразрывные", () => {
  assert.equal(rubles(1_000_000), "1 000 000 ₽");
  assert.equal(rubles(-73_007), "−73 007 ₽");
  const s = rawSummary(input());
  assert.match(s.text, /начальная цена 1 000 000 ₽/);
  assert.match(s.text, /\d+,\d % цены/);
  assert.ok(!/\d \d{3}/.test(s.verdict.reasons.join(" ")));
});

test("матрица в резюме: строка раздела — сколько проверено, риск и внимание; критичный риск матрицы не даёт сказать «можно»", () => {
  const base = input({}, { costs: 500_000 }, ["3.6. Оплата производится Заказчиком в течение 10 дней с даты акта."]);
  const calm = buildSummary(base);
  assert.equal(calm.verdict.level, "go");
  assert.equal(calm.sections.find((x) => x.id === "matrix")!.brief, "считаю…");
  // Матрица: нет лицензии, которой требует заказчик (критичная проверка 15, риск).
  const rows = buildMatrix({
    kind: "Электронный аукцион · 44-ФЗ",
    docs: [],
    hasContract: true,
    risks: base.risks,
    estimate: base.estimate,
    econ: base.econ,
    badge: null,
    ric: null,
    nmck: 1_000_000,
    smeOnly: false,
    companySme: false,
    registry: null,
    evidence: [{ requirement: { id: "r", text: "Наличие лицензии" }, needs: [], checks: [{ need: { kind: "license", label: "Лицензия или допуск", optional: false, scoring: false, requirement: { id: "r", group: "participant", text: "Наличие лицензии на деятельность" } }, status: "needs_evidence", facts: [], reasons: ["в базе нет"] }] }] as never,
  });
  const matrix = summarize(rows);
  assert.ok(matrix.risk >= 1);
  const withMatrix = buildSummary({ ...base, matrix });
  assert.equal(withMatrix.verdict.level, "careful");
  assert.ok(withMatrix.verdict.reasons.some((r) => /В матрице проверок риск по критичной проверке 15\. Соответствие требованиям к лицензиям/.test(r)));
  assert.match(withMatrix.sections.find((x) => x.id === "matrix")!.brief, /^проверено \d+ из 27 · риск 1/);
  // Риск по обычной (не критичной) проверке итог не меняет.
  const light = { ...matrix, first: matrix.first.map((r) => ({ ...r, weight: 1 as const })) };
  assert.equal(buildSummary({ ...base, matrix: light }).verdict.level, "go");
});

test("главное число: цена, с которой можно участвовать, и соседние цены; цена зелёная", () => {
  const s = buildSummary(input({}));
  assert.ok(s.headline, "есть затраты — есть главное число");
  assert.equal(s.headline!.label, "Участвовать можно по цене не ниже");
  assert.match(s.headline!.value, /^\d{3} \d{3} ₽$/);
  assert.match(s.headline!.note!, /^\d+,\d % от начальной$/);
  const labels = s.headline!.extras.map((x) => x.label);
  assert.ok(labels.includes("Целевая (с вашей маржой)"), labels.join("|"));
  assert.equal(s.headline!.extras.find((x) => x.label.startsWith("Целевая"))!.tone, "good");
  assert.equal(s.headline!.tone, "good", "главная цена зелёная при любом итоге светофора, кроме убытка");
});

test("главное число: убыток даже по начальной цене — красное, без соседних цен; нет затрат — главного числа нет", () => {
  const loss = buildSummary(input({}, { costs: 1_200_000 }));
  assert.equal(loss.headline!.tone, "danger");
  assert.equal(loss.headline!.label, "Убыток даже по начальной цене");
  assert.match(loss.headline!.value, /^−[\d ]+ ₽$/);
  assert.deepEqual(loss.headline!.extras, []);
  const none = buildSummary(input({}, { costs: null }));
  assert.equal(none.headline, null);
});

test("крупнейшие риски: до трёх, по убыванию рублей, тон по доле цены; в итог не входящие не берутся", () => {
  const s = buildSummary(input({}));
  assert.ok(s.topRisks.length >= 1 && s.topRisks.length <= 3);
  const amounts = s.topRisks.map((r) => Number(r.amount.replace(/[^\d]/g, "")));
  assert.deepEqual([...amounts].sort((a, b) => b - a), amounts);
  for (const r of s.topRisks) assert.match(r.pct, /^\d+,\d % цены$/);
  assert.ok(s.topRisks.every((r) => (r.tone === "danger") === (Number(r.pct.replace(",", ".").replace(/[^\d.]/g, "")) >= 20)));
});

test("строки разделов окрашены по важности: убыток красный, внимание янтарное, хорошее зелёное, остальное — просто факт", () => {
  const loss = buildSummary(input({}, { costs: 1_200_000 }));
  assert.equal(loss.sections.find((x) => x.id === "economics")!.tone, "danger");
  const ok = buildSummary(input({}));
  const tone = (id: string) => ok.sections.find((x) => x.id === id)!.tone;
  assert.ok(["good", "warn"].includes(tone("economics")!));
  assert.ok(ok.sections.every((x) => ["danger", "warn", "good", "muted"].includes(x.tone!)));
});

test("подпись внизу экрана: договор, риски в рублях, цена и рынок — по одной строке, без цитат и ввода", () => {
  const lines = findingsOf(input());
  assert.deepEqual(lines.map((l) => l.label), ["Договор", "Риски в рублях", "Цена и рынок"]);
  const by = (label: string) => plain(lines.find((l) => l.label === label)!.text);
  assert.match(by("Договор"), /^условий с цифрами: \d+, внимания требуют \d+/);
  assert.match(by("Риски в рублях"), /^до [\d ]+ ₽ \(\d+,\d % цены\); крупнейший — /);
  assert.match(by("Цена и рынок"), /^с рынком сравнить нечем/);
  assert.ok(lines.every((l) => ["danger", "warn", "good", "muted"].includes(l.tone)));
});

test("подпись: договора нет, рисков нет, расхождения в расчёте заказчика — так и сказано; тон по важности", () => {
  const none = findingsOf(input({ hasContract: false, risks: [] }));
  assert.match(none[0].text, /проекта договора в документах нет/);
  assert.equal(none[0].tone, "warn");
  const noCifr = findingsOf(input({ risks: [] }));
  assert.equal(noCifr[0].text, "условий с цифрами не нашла");
  const heavy = findingsOf(input({}, {}, [...LINES, "7.4. Исполнитель уплачивает Заказчику штраф в размере 30% от цены Договора."]));
  assert.equal(heavy[0].tone, "danger");
  assert.match(heavy[0].text, /крупная неустойка/);
  const flagged = findingsOf(input({ calcs: [{ issues: [{ level: "warn" }] }] as never }));
  assert.match(flagged.find((l) => l.label === "Цена и рынок")!.text, /в расчёте цены у заказчика расхождения: 1/);
  assert.equal(flagged.find((l) => l.label === "Цена и рынок")!.tone, "warn");
});

test("подпись: 27 проверок — отдельной строкой, только когда матрица посчитана; рынок — по бейджу", () => {
  const base = input();
  assert.ok(!findingsOf(base).some((l) => l.label === "27 проверок"));
  const matrix = { total: 27, program: 15, manual: 0, risk: 1, attention: 3, first: [] } as never;
  const line = findingsOf({ ...base, matrix }).find((l) => l.label === "27 проверок")!;
  assert.equal(line.text, "проверено 15 из 27, риск: 1, внимание: 3");
  assert.equal(line.tone, "danger");
  const within = findingsOf({ ...base, badge: { status: "within", title: "Цена в рыночном диапазоне", missing: [], detail: null } });
  assert.equal(within.find((l) => l.label === "Цена и рынок")!.text, "Цена в рыночном диапазоне");
  assert.equal(within.find((l) => l.label === "Цена и рынок")!.tone, "good");
});

test("подпись: поиск — не запускали, проверено и найдено; ссылки честно названы непроверенными; тем нет — строки нет", () => {
  assert.equal(searchFinding({ topics: 0, checked: 0, links: 0 }), null);
  assert.equal(searchFinding({ topics: 5, checked: 0, links: 0 })!.text, "риски отрасли и региона ещё не проверяли");
  const done = searchFinding({ topics: 5, checked: 4, links: 17 })!;
  assert.match(done.text, /проверено тем: 4 из 5, найдено ссылок: 17/);
  assert.match(done.text, /не проверены и в расчёт не входят/);
  assert.equal(done.label, "Поиск");
});
