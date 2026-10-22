// Матрица из 27 проверок: состав, расчёт 15 проверок из имеющихся данных, «не проверено» для остальных, результат, записанный участником, счёт без двойного учёта — npm test (без ИИ и интернета).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMatrix, CHECKS, DEFAULT_WEIGHTS, GROUPS, normalizeMatrix, summarize, type CheckRow, type MatrixInput } from "./check-matrix.ts";
import { contractRisks } from "./contract-risks.ts";
import { DEFAULT_ECON, economics } from "./economics.ts";
import type { PurchaseCheck } from "./evidence-match.ts";
import { computeRic, DEFAULT_SETTINGS, type RicData } from "./indicative-price.ts";
import { priceBadge } from "./price-badge.ts";
import type { PriceCalc } from "./price-floor.ts";
import { DEFAULT_ASSUMPTIONS, estimateRisks } from "./risk-estimate.ts";

const NOW = new Date("2026-10-22T12:00:00Z");
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
  "7.4. Исполнитель уплачивает Заказчику штраф в размере 30% от цены Договора за отказ от исполнения.",
  "3.6. Оплата производится Заказчиком в течение 30 дней с даты акта.",
  "10.1. Договор заключается после предоставления Исполнителем обеспечения исполнения Договора в размере 5 % от цены.",
  "5.12. Расходы на экспертизу несёт Исполнитель, за исключением случаев, когда экспертизой установлено отсутствие нарушений.",
  "11.2. Заказчик вправе принять решение об одностороннем отказе от исполнения контракта в случаях, предусмотренных законодательством.",
].join("\n");
const NOTICE = "Извещение. 5.1. Размер обеспечения заявки на участие в закупке — 1 % начальной (максимальной) цены контракта.";

const analog = (id: string, price: string) => ({ id, price, vat: "without" as const, source: "Прайс поставщика", date: "2026-10-10" });
const RIC_DATA: RicData = {
  positions: [{ id: "1", name: "Уголь", unit: "т", qty: "100", analogs: ["9000", "9500", "10000", "9800", "9700"].map((p, i) => analog(`a${i}`, p)) }],
  settings: { ...DEFAULT_SETTINGS, nmckVat: "without" },
};

// Требование заказчика с тем, что для него нашлось в базе компании (заготовка в форме, которую отдаёт evidence-match.ts).
const evidence = (kind: string, label: string, status: string, text = label, over: Record<string, unknown> = {}): PurchaseCheck =>
  ({
    requirement: { id: label, text },
    needs: [],
    checks: [{ need: { kind, label, optional: false, scoring: false, requirement: { id: label, group: "participant", text }, ...over }, status, facts: [], reasons: [`причина: ${label}`] }],
  }) as unknown as PurchaseCheck;

function input(over: Partial<MatrixInput> = {}, calc: Partial<PriceCalc> = {}): MatrixInput {
  const docs = [
    { name: "Проект договора.docx", text: CONTRACT },
    { name: "Извещение.docx", text: NOTICE },
  ];
  const risks = contractRisks(docs);
  const estimate = estimateRisks({ price: 1_000_000, risks, type: "goods", region: null, assumptions: DEFAULT_ASSUMPTIONS });
  const econ = economics({ calc: { ...CALC, ...calc }, estimate, settings: DEFAULT_ECON, price: null });
  const ric = computeRic(RIC_DATA, 1_000_000, NOW);
  return {
    kind: "Электронный аукцион · 44-ФЗ",
    docs,
    hasContract: true,
    risks,
    estimate,
    econ,
    badge: priceBadge(ric, RIC_DATA),
    ric,
    nmck: 1_000_000,
    smeOnly: false,
    companySme: false,
    registry: null,
    evidence: [],
    ...over,
  };
}

const row = (rows: CheckRow[], n: number) => rows.find((r) => r.def.n === n)!;
const level = (rows: CheckRow[], n: number) => {
  const r = row(rows, n).result;
  return r.state === "checked" || r.state === "manual" ? r.level : r.state;
};

test("состав: ровно 27 проверок в четырёх группах 6 + 7 + 6 + 8, номера подряд, у каждой описание, источник, правило, тема и важность", () => {
  assert.equal(CHECKS.length, 27);
  assert.deepEqual(CHECKS.map((c) => c.n), Array.from({ length: 27 }, (_, i) => i + 1));
  assert.deepEqual(GROUPS.map((g) => CHECKS.filter((c) => c.group === g.id).length), [6, 7, 6, 8]);
  for (const c of CHECKS) {
    assert.ok(c.title && c.what.length > 20 && c.source && c.rule.length > 20 && c.topic, `проверка ${c.n}`);
    assert.ok([1, 2, 3].includes(DEFAULT_WEIGHTS[c.n]));
  }
  assert.deepEqual(CHECKS.filter((c) => c.computed).map((c) => c.n), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 26]);
});

test("нет данных: ни одной выдуманной оценки — посчитанные программой проверки «недостаточно данных», внешние «не проверено» с источником, охват нулевой", () => {
  const rows = buildMatrix({
    kind: "",
    docs: [],
    hasContract: false,
    risks: [],
    estimate: estimateRisks({ price: null, risks: [], type: "general", region: null, assumptions: DEFAULT_ASSUMPTIONS }),
    econ: { ready: false, reason: "costs" },
    badge: null,
    ric: null,
    nmck: null,
    smeOnly: false,
    companySme: false,
    registry: null,
    evidence: null,
  });
  const s = summarize(rows);
  assert.equal(s.coveragePct, 0);
  assert.equal(s.program, 0);
  assert.equal(s.insufficient, 15);
  assert.equal(s.notChecked, 12);
  assert.equal(s.ok + s.attention + s.risk, 0);
  const external = row(rows, 21).result;
  assert.equal(external.state, "not_checked");
  assert.match(external.summary, /Пока нет источника в программе: Картотека арбитражных дел/);
  assert.ok(rows.filter((r) => r.result.state === "not_checked").every((r) => !r.def.computed));
  assert.ok(rows.filter((r) => r.result.state === "insufficient").every((r) => r.def.computed && r.result.state === "insufficient" && r.result.missing.length > 0));
});

test("финансы по договору: крупный штраф — риск, оплата 30 дней — внимание и деньги вперёд — внимание, обеспечение 5 % — в порядке; цитаты с пунктами", () => {
  const rows = buildMatrix(input());
  assert.equal(level(rows, 11), "risk");
  const pen = row(rows, 11).result;
  assert.ok(pen.state === "checked" && pen.facts.some((f) => /п\. 7\.4/.test(f)) && /Крупная неустойка/.test(pen.summary));
  assert.equal(level(rows, 10), "attention");
  assert.match((row(rows, 10).result as { summary: string }).summary, /Оплата долгая/);
  assert.equal(level(rows, 9), "ok");
  assert.equal(level(rows, 12), "attention");
  const wc = row(rows, 12).result;
  assert.ok(wc.state === "checked" && wc.facts.some((f) => /Аванса нет/.test(f)) && wc.facts.some((f) => /Проценты за эти деньги/.test(f)));
});

test("рентабельность: прибыль в базовом и стрессовом — в порядке, убыток только в стрессе — внимание, убыток в базовом — риск, нет затрат — недостаточно данных", () => {
  // Затраты 640 тыс.: в базовом прибыль есть, а в стрессе (рост затрат, двойной гарантийный резерв и штраф 30 %) — убыток.
  assert.equal(level(buildMatrix(input({}, { costs: 640_000 })), 13), "attention", "в стрессе у крупного штрафа убыток");
  assert.equal(level(buildMatrix(input({}, { costs: 400_000 })), 13), "ok", "при низких затратах прибыль выдерживает и штраф");
  const calm = input({}, { costs: 300_000 });
  const noPenalty = { ...calm, risks: calm.risks.filter((r) => r.kind !== "penalty") };
  const est = estimateRisks({ price: 1_000_000, risks: noPenalty.risks, type: "goods", region: null, assumptions: DEFAULT_ASSUMPTIONS });
  const econCalm = economics({ calc: { ...CALC, costs: 300_000 }, estimate: est, settings: DEFAULT_ECON, price: null });
  assert.equal(level(buildMatrix({ ...noPenalty, estimate: est, econ: econCalm }), 13), "ok");
  assert.equal(level(buildMatrix(input({}, { costs: 960_000 })), 13), "risk");
  const none = row(buildMatrix(input({}, { costs: null })), 13).result;
  assert.equal(none.state, "insufficient");
});

test("рыночная цена = закупочная: начальная цена около закупочной — внимание (маржи почти нет), существенно ниже — риск, существенно выше — в порядке; мало цен — недостаточно данных с тем, чего не хватает", () => {
  assert.equal(level(buildMatrix(input()), 7), "attention");
  const high: RicData = { ...RIC_DATA, positions: [{ ...RIC_DATA.positions[0], analogs: ["5000", "5100", "5200", "5050", "5150"].map((p, i) => analog(`h${i}`, p)) }] };
  const ric = computeRic(high, 1_000_000, NOW);
  const status = priceBadge(ric, high).status;
  assert.ok(status === "below" || status === "above", `закупочные цены сильно расходятся с начальной: ${status}`);
  assert.equal(level(buildMatrix(input({ ric, badge: priceBadge(ric, high) })), 7), status === "below" ? "risk" : "ok");
  const few: RicData = { ...RIC_DATA, positions: [{ ...RIC_DATA.positions[0], analogs: RIC_DATA.positions[0].analogs.slice(0, 2) }] };
  const ricFew = computeRic(few, 1_000_000, NOW);
  const r = row(buildMatrix(input({ ric: ricFew, badge: priceBadge(ricFew, few) })), 7).result;
  assert.equal(r.state, "insufficient");
  assert.equal(row(buildMatrix(input({ badge: null, ric: null })), 7).result.state, "insufficient");
});

test("обеспечение заявки: найдено в извещении, сумма из процента и начальной цены, сравнивается с прибылью; нет в документах — недостаточно данных; единственный поставщик — заявки нет", () => {
  const r = row(buildMatrix(input()), 8).result;
  assert.ok(r.state === "checked" && r.level === "ok");
  assert.ok(r.state === "checked" && r.facts.some((f) => /Замораживается около 10[\s ]000[\s ]₽/.test(f)));
  const big = buildMatrix(input({ docs: [{ name: "Извещение.docx", text: "Размер обеспечения заявки — 90 % начальной цены." }] }));
  assert.equal(level(big, 8), "attention");
  assert.equal(row(buildMatrix(input({ docs: [{ name: "Извещение.docx", text: "Прочий текст." }] })), 8).result.state, "insufficient");
  assert.equal(level(buildMatrix(input({ kind: "Закупка у единственного поставщика · 44-ФЗ" })), 8), "ok");
  const noCosts = row(buildMatrix(input({}, { costs: null })), 8).result;
  assert.equal(noCosts.state, "insufficient");
});

test("процедура: способ без ограничений — в порядке; единственный поставщик, закупка для МСП без категории в профиле, закрытый способ — внимание; МСП с категорией — в порядке", () => {
  assert.equal(level(buildMatrix(input()), 6), "ok");
  assert.equal(level(buildMatrix(input({ kind: "Закупка у единственного поставщика · 44-ФЗ" })), 6), "attention");
  assert.equal(level(buildMatrix(input({ smeOnly: true, companySme: false })), 6), "attention");
  assert.equal(level(buildMatrix(input({ smeOnly: true, companySme: true })), 6), "ok");
  assert.equal(level(buildMatrix(input({ kind: "Закрытый конкурс · 44-ФЗ" })), 6), "attention");
  const registry = { status: "found", registry: null, unsupported: null, mentions: [{ kind: "registry_number", role: "requirement", quote: "Участник указывает реестровый номер товара.", document: "ТЗ" }], appliesTo: [], notes: [] } as unknown as MatrixInput["registry"];
  assert.equal(level(buildMatrix(input({ registry })), 6), "attention");
});

test("односторонний отказ и приёмка: условие найдено с цитатой и пунктом; с крупной неустойкой на вас — риск; в договоре нет — «не найдено», не юридический вывод", () => {
  const r = row(buildMatrix(input()), 26).result;
  assert.ok(r.state === "checked" && r.level === "risk");
  assert.ok(r.state === "checked" && r.facts.some((f) => /Односторонний отказ: «11\.2\./.test(f)) && r.facts.some((f) => /экспертиз/i.test(f)));
  const light = buildMatrix(input({ docs: [{ name: "Проект договора.docx", text: "Договор поставки № 1\n11.2. Заказчик вправе принять решение об одностороннем отказе от исполнения контракта." }], risks: [] }));
  assert.equal(level(light, 26), "attention");
  const none = row(buildMatrix(input({ docs: [{ name: "Проект договора.docx", text: "Договор поставки № 1\n1.1. Поставщик поставляет товар." }], risks: [] })), 26).result;
  assert.ok(none.state === "checked" && none.level === "ok" && /не юридическая оценка/.test(none.summary));
  assert.equal(row(buildMatrix(input({ hasContract: false, risks: [] })), 26).result.state, "insufficient");
});

test("квалификация: требования заказчика против базы — подтверждено, скоро истечёт, нет доказательства; лицензия и СРО — разные проверки; «по желанию» не даёт риска", () => {
  const ev = [
    evidence("experience", "Опыт: исполненные договоры", "ok"),
    evidence("license", "Лицензия или допуск", "needs_evidence", "Наличие лицензии на деятельность"),
    evidence("license", "Лицензия или допуск", "expiring", "Членство в СРО в области строительства"),
    evidence("finance", "Финансовые данные", "expired"),
    evidence("equipment", "Оборудование или площадка", "ok"),
    evidence("employee", "Специалисты и их документы", "need_human"),
    evidence("certificate", "Сертификат или свидетельство", "needs_evidence", "Сертификат по баллам", { scoring: true }),
  ];
  const rows = buildMatrix(input({ evidence: ev }));
  assert.equal(level(rows, 14), "ok");
  assert.equal(level(rows, 15), "risk");
  assert.equal(level(rows, 16), "attention");
  assert.equal(level(rows, 17), "risk");
  assert.equal(level(rows, 18), "attention");
  assert.equal(level(rows, 19), "attention", "за баллы — внимание, а не риск");
  const lic = row(rows, 15).result;
  assert.ok(lic.state === "checked" && lic.facts[0].startsWith("Лицензия или допуск: Нет доказательства — причина"));
  assert.match((row(rows, 14).result as { summary: string }).summary, /Подтверждено: 1 из 1/);
});

test("квалификация: требований такого вида нет — в порядке, с пояснением; требования не выписаны или база не загружена — недостаточно данных", () => {
  const only = buildMatrix(input({ evidence: [evidence("experience", "Опыт: исполненные договоры", "ok")] }));
  assert.equal(level(only, 16), "ok");
  assert.match((row(only, 16).result as { summary: string }).summary, /не найдено/);
  assert.equal(row(buildMatrix(input({ evidence: [] })), 14).result.state, "insufficient");
  assert.equal(row(buildMatrix(input({ evidence: null })), 14).result.state, "insufficient");
});

test("записанное вами: подставляется вместо «не проверено» и «недостаточно данных», помечено «проверено вами»; посчитанное программой не перекрывается; пустая заметка не считается", () => {
  const rows = buildMatrix(
    input({
      manual: {
        21: { level: "attention", note: "В КАД найдено 3 спора об оплате за 2025 год.", source: "kad.arbitr.ru, по ИНН" },
        11: { level: "ok", note: "всё нормально", source: "" },
        3: { level: "ok", note: "   ", source: "" },
      },
    }),
  );
  const c = row(rows, 21).result;
  assert.deepEqual(c, { state: "manual", level: "attention", summary: "В КАД найдено 3 спора об оплате за 2025 год.", source: "kad.arbitr.ru, по ИНН" });
  assert.equal(level(rows, 11), "risk", "посчитанное программой не перекрывается");
  assert.equal(row(rows, 3).result.state, "not_checked");
  const noEvidence = buildMatrix(input({ evidence: null, manual: { 14: { level: "ok", note: "Есть 3 акта за 2024–2026", source: "папка «Опыт»" } } }));
  assert.equal(row(noEvidence, 14).result.state, "manual");
});

test("счёт: проверено из 27, в порядке, внимание, риск; один риск, описанный несколькими проверками, считается один раз (общая тема)", () => {
  const rows = buildMatrix(input({ evidence: [evidence("experience", "Опыт", "ok")], manual: { 21: { level: "attention", note: "Споры об оплате", source: "КАД" } } }));
  const s = summarize(rows);
  assert.equal(s.total, 27);
  assert.equal(s.program + s.manual + s.insufficient + s.notChecked, 27);
  assert.equal(s.manual, 1);
  assert.equal(s.ok + s.attention + s.risk, s.program + s.manual);
  assert.ok(Math.abs(s.coveragePct - ((s.program + s.manual) / 27) * 100) < 1e-9);
  // Оплата (10) и оборотный капитал (12) — одна тема: оба «внимание», но тема одна.
  assert.equal(level(rows, 10), "attention");
  assert.equal(level(rows, 12), "attention");
  const attentionChecks = rows.filter((r) => (r.result.state === "checked" || r.result.state === "manual") && r.result.level === "attention");
  const topics = new Set(attentionChecks.map((r) => r.def.topic));
  assert.equal(s.uniqueAttention, topics.size);
  assert.ok(s.uniqueAttention < s.attention, "две проверки об оплате считаются как одна тема");
  assert.deepEqual(s.groups.map((g) => g.total), [6, 7, 6, 8]);
  assert.equal(s.groups.reduce((n, g) => n + g.done, 0), s.program + s.manual);
});

test("счёт: риск перекрывает внимание в одной теме; «что смотреть первым» — сначала риск, затем внимание, от самой важной проверки", () => {
  const s = summarize(buildMatrix(input()));
  assert.ok(s.first.length >= 3);
  const order = s.first.map((r) => [r.result.state === "checked" ? r.result.level : "x", r.weight, r.def.n]);
  for (let i = 1; i < order.length; i++) {
    const [la, wa, na] = order[i - 1] as [string, number, number];
    const [lb, wb, nb] = order[i] as [string, number, number];
    const rank = (l: string) => (l === "risk" ? 2 : 1);
    assert.ok(rank(la) > rank(lb) || (rank(la) === rank(lb) && (wa > wb || (wa === wb && na < nb))));
  }
  assert.equal(s.first[0].result.state === "checked" && s.first[0].result.level, "risk");
  assert.ok(s.first.every((r) => r.result.state === "checked" && r.result.level !== "ok"));
});

test("важность: меняется участником (1–3), неправильное значение — по умолчанию", () => {
  const rows = buildMatrix(input({ weights: { 11: 1, 13: 5, 14: 2.5 } }));
  assert.equal(row(rows, 11).weight, 1);
  assert.equal(row(rows, 13).weight, 3, "5 — не важность: берётся по умолчанию");
  assert.equal(row(rows, 14).weight, DEFAULT_WEIGHTS[14]);
  assert.equal(row(rows, 1).weight, DEFAULT_WEIGHTS[1]);
});

test("хранилище: записанное вами и веса читаются, неизвестные проверки, пустые заметки и мусор отбрасываются", () => {
  const raw = {
    weights: { "11": 1, "13": 9, "99": 2, "x": 3 },
    manual: {
      "21": { level: "risk", note: "  Иск о долге  ", source: " КАД " },
      "22": { level: "risk", note: "" },
      "23": { level: "плохо", note: "текст" },
      "99": { level: "ok", note: "нет такой проверки" },
      "24": "мусор",
    },
  };
  assert.deepEqual(normalizeMatrix(raw), { weights: { "11": 1 }, manual: { "21": { level: "risk", note: "Иск о долге", source: "КАД" } } });
  assert.deepEqual(normalizeMatrix(null), {});
  assert.deepEqual(normalizeMatrix({ weights: [], manual: "x" }), {});
});
