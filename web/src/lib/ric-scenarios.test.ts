// Сценарии РИЦ по сферам: полнота справочника, определение сферы по предмету, расчёт поправок и резерва на риски — npm test (без ИИ и интернета).
import assert from "node:assert/strict";
import { test } from "node:test";
import { HYPOTHESES } from "./hidden-costs.ts";
import { computeRic, DEFAULT_SETTINGS, EMPTY_RIC, normalizeRic, type RicAdjustment, type RicData } from "./indicative-price.ts";
import { METHOD_LABELS, parseSigned, readiness, scenarioById, scenarioOf, scenarioRic, SCENARIOS, SOURCE_LABELS } from "./ric-scenarios.ts";

const NOW = new Date("2026-10-22T12:00:00Z");
const analog = (id: string, price: string) => ({ id, price, vat: "without" as const, source: "Прайс поставщика", date: "2026-10-10" });
const ONE: RicData = {
  positions: [{ id: "1", name: "Уголь", unit: "т", qty: "100", analogs: ["9000", "9500", "10000", "9800", "9700"].map((p, i) => analog(`a${i}`, p)) }],
  settings: { ...DEFAULT_SETTINGS, nmckVat: "without" },
};
const withEntries = (adjustments: RicAdjustment[], scenario?: string): RicData => ({ ...ONE, adjustments, ...(scenario && { scenario }) });
const calc = (data: RicData, subject = "Поставка угля", type = "goods", nmck = 1_000_000) => scenarioRic(data, computeRic(data, nmck, NOW), subject, type);

test("справочник: девять сфер, у каждой метод, опора, шаги, поправки, риски и ссылки на закон — без пустых мест", () => {
  assert.deepEqual(SCENARIOS.map((s) => s.id), ["goods", "fuel", "construction", "services", "it", "logistics", "food", "medical", "general"]);
  for (const s of SCENARIOS) {
    assert.ok(s.title && s.applies, s.id);
    assert.ok(s.methods.length >= 1 && s.methods.some((m) => m.role === "основной"), `${s.id}: нужен основной метод`);
    for (const m of s.methods) assert.ok(METHOD_LABELS[m.id] && m.why.length > 20, `${s.id}: метод ${m.id}`);
    assert.ok(s.basis.length >= 2 && s.basis.some((b) => b.source === "documents") && s.basis.some((b) => b.source === "participant"), `${s.id}: опора из документов и от участника`);
    for (const b of s.basis) assert.ok(SOURCE_LABELS[b.source] && b.what && b.note, `${s.id}: ${b.what}`);
    assert.ok(s.steps.length >= 3, `${s.id}: шаги`);
    assert.ok(s.adjustments.length >= 2, `${s.id}: поправки`);
    assert.ok(s.risks.length >= 1, `${s.id}: риски`);
    assert.equal(new Set(s.adjustments.map((a) => a.id)).size, s.adjustments.length, `${s.id}: повторы поправок`);
    assert.equal(new Set(s.risks.map((r) => r.id)).size, s.risks.length, `${s.id}: повторы рисков`);
    for (const a of s.adjustments) assert.ok(a.label && a.hint && (a.unit === "percent" || a.unit === "rub"), `${s.id}/${a.id}`);
    for (const r of s.risks) assert.ok(r.label && r.effect && r.ask && (r.unit === "percent" || r.unit === "rub"), `${s.id}/${r.id}`);
    assert.ok(s.legal.length >= 2 && s.legal.some((l) => /сверьте/.test(l)), `${s.id}: ссылки на закон с пометкой «сверьте»`);
  }
});

test("справочник: гипотезы, на которые ссылаются риски, есть в каталоге скрытых затрат", () => {
  const known = new Set(HYPOTHESES.map((h) => h.id));
  for (const s of SCENARIOS) for (const r of s.risks) if (r.hypothesisId) assert.ok(known.has(r.hypothesisId), `${s.id}/${r.id}: гипотезы «${r.hypothesisId}» нет в каталоге`);
});

test("справочник: сферы различаются по существу — у стройки проектно-сметный метод и предупреждение, у ИТ затратный, у логистики рейс из затрат, у топлива тариф, у лекарств предельные цены", () => {
  const roles = (id: string) => scenarioById(id)!.methods.map((m) => `${m.id}:${m.role}`);
  assert.ok(roles("construction").includes("estimate:основной"));
  assert.match(scenarioById("construction")!.caution!, /не заменяют смету/);
  assert.match(scenarioById("construction")!.legal.join(" "), /ч\. 9–9\.1 ст\. 22/);
  assert.ok(roles("it").includes("cost:основной"));
  assert.ok(roles("logistics").includes("cost:проверка") && roles("logistics").includes("market:основной"));
  assert.ok(roles("fuel").includes("tariff:основной"));
  assert.ok(roles("services").includes("cost:основной"));
  assert.ok(roles("food").includes("normative:основной"));
  assert.match(scenarioById("medical")!.basis.map((b) => b.what).join(" "), /Предельные цены/);
  assert.match(scenarioById("medical")!.caution!, /нуждается в проверке специалистом/);
  assert.ok(roles("goods").every((r) => r.startsWith("market")));
  const adjustmentIds = (id: string) => scenarioById(id)!.adjustments.map((a) => a.id);
  assert.ok(adjustmentIds("construction").includes("winter") && adjustmentIds("logistics").includes("empty") && adjustmentIds("it").includes("reserve") && adjustmentIds("fuel").includes("quality"));
  assert.equal(scenarioById("nope"), null);
  assert.equal(scenarioById(null), null);
});

test("сфера по предмету: настоящие формулировки закупок попадают в свою сферу", () => {
  const cases: [string, string][] = [
    ["Поставка угля марки ДПК для нужд котельных", "fuel"],
    ["Поставка дизельного топлива и бензина", "fuel"],
    ["Поставка электрической энергии для муниципальных нужд", "fuel"],
    ["Организация питания обучающихся", "food"],
    ["Поставка продуктов питания в детские сады", "food"],
    ["Капитальный ремонт балконов многоквартирного дома", "construction"],
    ["Ремонт кабинетов и благоустройство территории", "construction"],
    ["Строительство спортивной площадки", "construction"],
    ["Ремонт и техническое обслуживание оргтехники", "services"],
    ["Оказание услуг по перевозке грузов автомобильным транспортом", "logistics"],
    ["Услуги пассажирских перевозок", "logistics"],
    ["Поставка товара, включая доставку товара до склада заказчика", "goods"],
    ["Разработка программного обеспечения для портала", "it"],
    ["Оказание услуг по технической поддержке информационной системы", "it"],
    ["Поставка лекарственных препаратов", "medical"],
    ["Поставка медицинских изделий для больницы", "medical"],
    ["Оказание охранных услуг", "services"],
    ["Уборка помещений", "services"],
    ["Поставка мебели для школы", "goods"],
    ["Поставка оборудования", "goods"],
  ];
  for (const [subject, expected] of cases) assert.equal(scenarioOf(subject), expected, subject);
});

test("сфера по предмету: предмет без узнаваемых слов — по виду закупки; совсем без подсказок — общий сценарий", () => {
  assert.equal(scenarioOf("Закупка № 123", "works"), "construction");
  assert.equal(scenarioOf("Закупка № 123", "services"), "services");
  assert.equal(scenarioOf("Закупка № 123", "it"), "it");
  assert.equal(scenarioOf("Закупка № 123", "food"), "food");
  assert.equal(scenarioOf("Закупка № 123", "goods"), "goods");
  assert.equal(scenarioOf("Закупка № 123"), "general");
  assert.equal(scenarioOf("", "unknown"), "general");
});

test("число со знаком: плюс, минус, запятая, пробелы; не число — null", () => {
  assert.equal(parseSigned("5"), 5);
  assert.equal(parseSigned("-3,5"), -3.5);
  assert.equal(parseSigned("−12 000"), -12_000);
  assert.equal(parseSigned(" 20 000,50 "), 20_000.5);
  assert.equal(parseSigned("пять"), null);
  assert.equal(parseSigned(""), null);
  assert.equal(parseSigned("5%"), null);
});

test("расчёт: без поправок РИЦ с поправками равен РИЦ по методу, сфера определена по предмету, начальная цена сравнивается с ним", () => {
  const r = calc(ONE);
  assert.equal(r.scenario.id, "fuel");
  assert.equal(r.chosen, false);
  assert.equal(r.base, 960_000);
  assert.equal(r.adjusted, 960_000);
  assert.equal(r.withRisks, 960_000);
  assert.equal(r.reserve, 0);
  assert.ok(r.adjustments.every((a) => !a.counted && a.effect === null));
  assert.deepEqual(r.deviation, { abs: 40_000, pct: (40_000 / 960_000) * 100 });
});

test("расчёт: рубли добавляются как есть, проценты — от РИЦ по методу, минус уменьшает; итог и диапазон сдвигаются на сумму поправок", () => {
  const r = calc(withEntries([
    { id: "delivery", value: "20 000", basis: "КП перевозчика от 10.10.2026" },
    { id: "season", value: "-5", basis: "цены аналогов взяты перед отопительным периодом" },
    { id: "quality", value: "2", basis: "калорийность выше на 2 %" },
  ]));
  const by = Object.fromEntries(r.adjustments.map((a) => [a.id, a]));
  assert.equal(by.delivery.effect, 20_000);
  assert.equal(by.season.effect, -48_000);
  assert.equal(by.quality.effect, 19_200);
  assert.ok(Object.values(by).filter((a) => a.counted).length === 3);
  assert.equal(r.adjusted, 960_000 + 20_000 - 48_000 + 19_200);
  assert.equal(r.adjustedRange!.from - r.range!.from, r.adjusted! - r.base!);
  assert.equal(r.adjustedRange!.to - r.range!.to, r.adjusted! - r.base!);
  assert.deepEqual(r.deviation!.abs, 1_000_000 - r.adjusted!);
});

test("расчёт: поправка без основания, без числа или с «не числом» в расчёт не идёт — с понятной причиной", () => {
  const r = calc(withEntries([
    { id: "delivery", value: "20000", basis: "" },
    { id: "season", value: "пять", basis: "что-то" },
    { id: "tax", value: "", basis: "основание без числа" },
    { id: "quality", value: "0", basis: "не отличается" },
  ]));
  const by = Object.fromEntries(r.adjustments.map((a) => [a.id, a]));
  assert.equal(by.delivery.counted, false);
  assert.match(by.delivery.reason!, /Нет основания/);
  assert.equal(by.season.counted, false);
  assert.match(by.season.reason!, /Не число/);
  assert.equal(by.tax.counted, false);
  assert.equal(by.tax.reason, null);
  assert.equal(by.quality.counted, false);
  assert.equal(r.adjusted, r.base);
});

test("расчёт: резерв на отраслевые риски — отдельно от РИЦ: проценты от РИЦ с поправками, рубли как есть, итог «с учётом рисков»", () => {
  const r = calc(withEntries([
    { id: "delivery", value: "40000", basis: "КП" },
    { id: "risk-price", value: "3", basis: "рост цены топлива за последние месяцы по данным поставщика" },
    { id: "risk-demurrage", value: "15000", basis: "тариф за простой по договору" },
    { id: "risk-logistics", value: "9999", basis: "" },
  ]));
  assert.equal(r.adjusted, 1_000_000);
  const by = Object.fromEntries(r.risks.map((x) => [x.id, x]));
  assert.equal(by.price.effect, 30_000);
  assert.equal(by.demurrage.effect, 15_000);
  assert.equal(by.logistics.counted, false);
  assert.equal(r.reserve, 45_000);
  assert.equal(r.withRisks, 1_045_000);
  assert.equal(r.adjusted, 1_000_000, "РИЦ с поправками резервом не меняется");
});

test("расчёт: своя поправка участника — с названием и единицей; она тоже требует число и основание", () => {
  const r = calc(withEntries([
    { id: "custom-1", label: "Страховка партии", unit: "rub", value: "7 500", basis: "полис страховой компании" },
    { id: "custom-2", label: "Без основания", unit: "percent", value: "10", basis: "" },
  ]));
  const customs = r.adjustments.filter((a) => a.id.startsWith("custom-"));
  assert.deepEqual(customs.map((a) => [a.label, a.counted, a.effect]), [["Страховка партии", true, 7_500], ["Без основания", false, null]]);
  assert.equal(r.adjusted, 967_500);
});

test("расчёт: РИЦ по методу не посчитан полностью — поправки и резервы ждут его, ничего не придумывается", () => {
  const partial: RicData = { ...ONE, positions: [{ ...ONE.positions[0], analogs: ONE.positions[0].analogs.slice(0, 2) }], adjustments: [{ id: "delivery", value: "20000", basis: "КП" }] };
  const r = calc(partial);
  assert.equal(r.base, null);
  assert.equal(r.adjusted, null);
  assert.equal(r.withRisks, null);
  assert.equal(r.deviation, null);
  assert.match(r.adjustments.find((a) => a.id === "delivery")!.reason!, /РИЦ по методу ещё не посчитан/);
  const empty = calc(EMPTY_RIC);
  assert.equal(empty.base, null);
  assert.equal(empty.adjusted, null);
});

test("расчёт: сфера, выбранная участником, главнее определённой по предмету; неизвестная — как не выбрана", () => {
  const picked = calc({ ...ONE, scenario: "logistics" });
  assert.equal(picked.scenario.id, "logistics");
  assert.equal(picked.chosen, true);
  assert.equal(calc({ ...ONE, scenario: "астрология" }).scenario.id, "fuel");
  assert.equal(calc(ONE, "Ремонт кабинетов", "works").scenario.id, "construction");
  // Поправка из другой сферы к выбранной не подходит: считаются только поправки её сценария и свои.
  const other = calc({ ...ONE, scenario: "logistics", adjustments: [{ id: "season", value: "5", basis: "сезон" }] });
  assert.equal(other.adjusted, other.base);
});

test("готовность: что есть и чего не хватает; внешние источники сферы названы, что в программе их нет", () => {
  const ready = readiness(scenarioById("construction")!, computeRic(ONE, 1_000_000, NOW), ONE);
  assert.deepEqual(ready.slice(0, 4).map((x) => x.ok), [true, true, true, true]);
  assert.ok(ready.some((x) => x.ok === null && /Сметные нормативы и индексы/.test(x.text) && /подключения к ним в программе нет/.test(x.text)));
  const partial: RicData = { ...ONE, positions: [{ ...ONE.positions[0], analogs: ONE.positions[0].analogs.slice(0, 2) }], adjustments: [{ id: "delivery", value: "5", basis: "" }] };
  const bad = readiness(scenarioById("goods")!, computeRic(partial, 1_000_000, NOW), partial);
  assert.deepEqual(bad.slice(0, 3).map((x) => x.ok), [true, false, false]);
  assert.ok(bad.some((x) => /без основания: 1/.test(x.text)));
  const none = readiness(scenarioById("goods")!, computeRic(EMPTY_RIC, null, NOW), EMPTY_RIC);
  assert.deepEqual(none.slice(0, 3).map((x) => x.ok), [false, false, false]);
  assert.match(none[0].text, /не добавлены/);
});

test("хранилище: сфера и поправки читаются, лишнее и повреждённое отбрасывается, прежние данные без них не меняются", () => {
  assert.deepEqual(normalizeRic(null), EMPTY_RIC);
  assert.deepEqual(normalizeRic({ positions: [], settings: {} }), EMPTY_RIC);
  const raw = {
    positions: [],
    settings: {},
    scenario: "logistics",
    adjustments: [
      { id: "delivery", value: "20000", basis: "КП", label: "подделка", unit: "percent" },
      { id: "custom-9", label: "Своя", unit: "percent", value: "3", basis: "расчёт" },
      { id: "Плохой id!", value: "1", basis: "x" },
      { id: "x", value: 5, basis: "не строка" },
      "мусор",
      null,
    ],
  };
  const n = normalizeRic(raw);
  assert.equal(n.scenario, "logistics");
  assert.deepEqual(n.adjustments, [
    { id: "delivery", value: "20000", basis: "КП" },
    { id: "custom-9", label: "Своя", unit: "percent", value: "3", basis: "расчёт" },
    { id: "x", value: "", basis: "не строка" },
  ]);
  assert.equal(normalizeRic({ scenario: "Не id!!" }).scenario, undefined);
});
