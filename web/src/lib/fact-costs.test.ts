// Суммы по фактам: расстояние между регионами, доставка по тарифу участника, риск курса по данным ЦБ и их строки в «Сколько это может стоить» — npm test (без сети).
import assert from "node:assert/strict";
import { test } from "node:test";
import { deliveryCost, EMPTY_DELIVERY, normalizeDelivery, type DeliveryInputs } from "./delivery-cost.ts";
import { deliveryItems, fxItems } from "./fact-estimates.ts";
import { EMPTY_FX, fxRisk, normalizeFx, parseCbrDynamic, worstRise } from "./fx-risk.ts";
import { DEFAULT_ROAD_FACTOR, legBetween, REGION_GEO, straightKm } from "./geo.ts";
import { REGION_NAMES } from "./regions.ts";
import { DEFAULT_ASSUMPTIONS, estimateRisks } from "./risk-estimate.ts";

// Курс доллара США по официальным данным Банка России (cbr.ru, динамика R01235), 01–22.10.2026.
const RATES: [string, string][] = [
  ["01.10.2026", "83,5588"],
  ["02.10.2026", "83,2454"],
  ["03.10.2026", "83,4839"],
  ["06.10.2026", "84,9309"],
  ["07.10.2026", "85,7116"],
  ["08.10.2026", "85,4811"],
  ["09.10.2026", "85,4173"],
  ["10.10.2026", "84,9048"],
  ["13.10.2026", "83,9153"],
  ["14.10.2026", "83,8675"],
  ["15.10.2026", "83,9497"],
  ["16.10.2026", "83,7600"],
  ["17.10.2026", "83,6177"],
  ["20.10.2026", "82,8504"],
  ["21.10.2026", "82,8879"],
  ["22.10.2026", "81,9739"],
];
const CBR_XML =
  `<?xml version="1.0" encoding="windows-1251"?><ValCurs ID="R01235" DateRange1="01.10.2026" DateRange2="22.10.2026" name="Foreign Currency Market Dynamic">` +
  RATES.map(([d, v]) => `<Record Date="${d}" Id="R01235"><Nominal>1</Nominal><Value>${v}</Value><VunitRate>${v}</VunitRate></Record>`).join("") +
  `</ValCurs>`;

test("у каждого региона списка есть координаты центра, лишних нет, все в пределах России", () => {
  assert.deepEqual(Object.keys(REGION_GEO).sort(), [...REGION_NAMES].sort());
  for (const [name, g] of Object.entries(REGION_GEO)) {
    assert.ok(g.lat > 41 && g.lat < 70 && g.lon > 19 && g.lon < 180, `${name}: ${g.lat}, ${g.lon}`);
    assert.ok(g.center.length > 2, name);
  }
});

test("расстояние по прямой: Москва — Петербург около 635 км, Москва — Севастополь 1 271 км; тот же регион и неизвестный — нет маршрута", () => {
  const moscow = REGION_GEO["Москва"];
  assert.ok(Math.abs(straightKm(moscow, REGION_GEO["Санкт-Петербург"]) - 635) < 3);
  const leg = legBetween("Москва", "Севастополь")!;
  assert.equal(leg.straight, 1271);
  assert.equal(leg.factor, DEFAULT_ROAD_FACTOR);
  assert.equal(leg.road, Math.round(1271 * 1.3));
  assert.equal(leg.note, null);
  assert.equal(legBetween("Москва", "Москва"), null);
  assert.equal(legBetween("Москва", "Нет такого региона"), null);
  assert.equal(legBetween("Москва", "Севастополь", 9)!.factor, DEFAULT_ROAD_FACTOR, "нелепый коэффициент заменяется обычным");
  assert.equal(legBetween("Москва", "Севастополь", 1.5)!.road, Math.round(1271 * 1.5));
});

test("Камчатка, Чукотка, Сахалин, Калининград, Якутия: дорога по прямой не считается, сказано почему", () => {
  for (const hard of ["Камчатский край", "Чукотский автономный округ", "Сахалинская область", "Калининградская область", "Республика Саха (Якутия)"]) {
    const leg = legBetween("Москва", hard)!;
    assert.equal(leg.road, null, hard);
    assert.match(leg.note!, /сезонная|неполная/);
    assert.ok(leg.straight > 1000);
  }
  assert.equal(legBetween("Камчатский край", "Москва")!.road, null, "и в обратную сторону");
});

const carrier = (over: Partial<DeliveryInputs> = {}): DeliveryInputs => ({ ...EMPTY_DELIVERY, mode: "carrier", rate: "60", trips: "2", ...over });
const ROAD = Math.round(1271 * 1.3);

test("доставка перевозчиком: км × 2 (туда и обратно) × тариф × рейсы; формула словами", () => {
  const d = deliveryCost("Москва", "Севастополь", carrier());
  assert.equal(d.km, ROAD);
  assert.equal(d.cost, ROAD * 2 * 60 * 2);
  assert.equal(d.extra, null);
  assert.equal(d.formula, `${ROAD.toLocaleString("ru-RU").replace(/[  ]/g, " ")} км × 2 (туда и обратно) × 60 ₽/км × 2 рейс.`);
  assert.deepEqual(d.missing, []);
  assert.equal(deliveryCost("Москва", "Севастополь", carrier({ roundTrip: false })).cost, ROAD * 60 * 2);
});

test("своя машина: расход × цена литра за километр, только топливо; нет цены литра — сказано, что вписать, суммы нет", () => {
  const own = deliveryCost("Москва", "Севастополь", { ...EMPTY_DELIVERY, mode: "own", consumption: "30", fuel: "65", trips: "1" });
  assert.equal(own.cost, Math.round(ROAD * 2 * (30 / 100) * 65 * 100) / 100);
  assert.match(own.formula!, /только топливо/);
  const noFuel = deliveryCost("Москва", "Севастополь", { ...EMPTY_DELIVERY, mode: "own", consumption: "30", trips: "1" });
  assert.equal(noFuel.cost, null);
  assert.deepEqual(noFuel.missing, ["цену литра"]);
  const none = deliveryCost("Москва", "Севастополь", EMPTY_DELIVERY);
  assert.deepEqual(none.missing, ["тариф перевозчика, ₽ за км"]);
  assert.equal(none.km, ROAD, "расстояние известно и без тарифа");
});

test("обычное расстояние: на сколько дороже обычного и во сколько раз дальше; не дальше обычного — разницы нет", () => {
  const d = deliveryCost("Москва", "Севастополь", carrier({ usualKm: "200" }));
  assert.equal(d.usualCost, 200 * 2 * 60 * 2);
  assert.equal(d.extra, ROAD * 240 - 200 * 240);
  assert.equal(d.times, Math.round((ROAD / 200) * 10) / 10);
  const near = deliveryCost("Москва", "Московская область", carrier({ usualKm: "5000" }));
  assert.equal(near.extra, 0);
});

test("доставка: нет региона места поставки или он тот же — расчёта нет, а недоступная дорога — не сумма", () => {
  assert.equal(deliveryCost(null, "Севастополь", carrier()).cost, null);
  assert.equal(deliveryCost("Москва", "Москва", carrier()).leg, null);
  const kamchatka = deliveryCost("Москва", "Камчатский край", carrier());
  assert.equal(kamchatka.cost, null);
  assert.equal(kamchatka.km, null);
});

test("данные доставки из хранилища: мусор не ломает, поля обрезаются", () => {
  assert.deepEqual(normalizeDelivery(null), EMPTY_DELIVERY);
  const n = normalizeDelivery({ mode: "x", rate: 5, trips: "3", roundTrip: false, fuel: "9".repeat(80) });
  assert.equal(n.mode, "carrier");
  assert.equal(n.rate, "");
  assert.equal(n.trips, "3");
  assert.equal(n.roundTrip, false);
  assert.equal(n.fuel.length, 24);
});

test("курсы ЦБ: разбор ответа — даты по возрастанию, курс за единицу (значение ÷ номинал); мусор пропускается", () => {
  const points = parseCbrDynamic(CBR_XML);
  assert.equal(points.length, 16);
  assert.deepEqual(points[0], { date: "2026-10-01", rate: 83.5588 });
  assert.deepEqual(points[15], { date: "2026-10-22", rate: 81.9739 });
  const jpy = parseCbrDynamic(
    `<Record Date="02.10.2026" Id="R01820"><Nominal>100</Nominal><Value>55,5</Value></Record><Record Date="01.10.2026" Id="R01820"><Nominal>100</Nominal><Value>55,0</Value></Record><Record Date="xx" Id="R"><Nominal>1</Nominal><Value>7</Value></Record>`,
  );
  assert.deepEqual(jpy.map((p) => p.rate), [0.55, 0.555]);
  assert.deepEqual(parseCbrDynamic("не xml"), []);
});

test("наибольший рост курса за срок: на настоящих курсах октября 2026 за 5 дней +2,96 %, за 3 дня +1,73 %; курс падает — 0 %", () => {
  const points = parseCbrDynamic(CBR_XML);
  const w5 = worstRise(points, 5)!;
  assert.equal(w5.from.date, "2026-10-02");
  assert.equal(w5.to.date, "2026-10-07");
  assert.ok(Math.abs(w5.pct - (85.7116 / 83.2454 - 1) * 100) < 1e-9);
  const w3 = worstRise(points, 3)!;
  assert.ok(Math.abs(w3.pct - (84.9309 / 83.4839 - 1) * 100) < 1e-9);
  assert.ok(worstRise(points, 1)!.pct < w3.pct);
  const falling = worstRise([{ date: "2026-10-01", rate: 90 }, { date: "2026-10-02", rate: 80 }], 30)!;
  assert.equal(falling.pct, 0);
  assert.equal(worstRise([{ date: "2026-10-01", rate: 90 }], 30), null);
  assert.equal(worstRise(points, 0), null);
});

const fxInputs = (over = {}) => ({ ...EMPTY_FX, series: parseCbrDynamic(CBR_XML).map((p) => [p.date, p.rate] as [string, number]), amount: "10000", windowDays: "5", ...over });

test("риск курса: закупка 10 000 $ по курсу ЦБ на 22.10.2026, надбавка по росту, который бывал; без суммы или курса — что вписать", () => {
  const r = fxRisk(fxInputs());
  assert.equal(r.last!.date, "2026-10-22");
  assert.equal(r.exposure, Math.round(10000 * 81.9739 * 100) / 100);
  assert.ok(Math.abs(r.extra! - r.exposure! * (85.7116 / 83.2454 - 1)) < 0.01);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(fxRisk(fxInputs({ amount: "" })).missing, ["сумму в валюте"]);
  assert.deepEqual(fxRisk({ ...EMPTY_FX, amount: "100" }).missing, ["загрузите курс ЦБ"]);
  assert.equal(fxRisk(fxInputs({ amount: "" })).extra, null);
});

test("данные курса из хранилища: плохие точки и валюты отбрасываются", () => {
  const n = normalizeFx({ code: "GBP", amount: "5", series: [["2026-10-01", 80], ["x", 1], ["2026-10-02", -3], ["2026-10-03", "81"], ["2026-10-04", 82]] });
  assert.equal(n.code, "USD");
  assert.deepEqual(n.series, [["2026-10-01", 80], ["2026-10-04", 82]]);
  assert.deepEqual(normalizeFx(undefined), EMPTY_FX);
});

// В суммах и километрах пробелы неразрывные (так читается в экране); в проверках сравниваем с обычным пробелом.
const flat = (s: string) => s.replace(/\s/g, " ");

const estimate = (facts: ReturnType<typeof deliveryItems>) =>
  estimateRisks({
    price: 5_000_000,
    risks: [],
    type: "goods",
    region: { kind: "other", place: { name: "Севастополь", hard: true }, company: { name: "Москва", hard: false } },
    assumptions: DEFAULT_ASSUMPTIONS,
    facts,
  });

test("«Сколько это может стоить»: доставка дороже обычной и курс входят в итог; общая строка «сумма не определена» исчезает", () => {
  const d = deliveryCost("Москва", "Севастополь", carrier({ usualKm: "200" }));
  const fx = fxRisk(fxInputs());
  const result = estimate([...deliveryItems(d), ...fxItems(fx)]);
  const logistics = result.items.filter((i) => i.id === "logistics");
  assert.equal(logistics.length, 1);
  assert.equal(logistics[0].kind, "estimate");
  assert.equal(logistics[0].inTotal, true);
  assert.equal(logistics[0].amount, d.extra);
  assert.match(flat(logistics[0].basis), /центры регионов \(Москва → Севастополь\), 1 271 км по прямой × 1,3/);
  const fxItem = result.items.find((i) => i.id === "fx")!;
  assert.equal(fxItem.amount, fx.extra);
  assert.match(flat(fxItem.scenario), /до \+3,0 %/);
  assert.match(flat(fxItem.scenario), /81,9739 ₽ на 22\.10\.2026/);
  // К итогу прежних оценок (например, гарантийного резерва) добавляются доставка и курс.
  assert.equal(result.total, Math.round((estimate([]).total + d.extra! + fx.extra!) * 100) / 100);
});

test("доставка без тарифа: расстояние уже факт, сумма не определена и сказано, что вписать; без фактов — прежняя общая строка", () => {
  const [item] = deliveryItems(deliveryCost("Москва", "Севастополь", EMPTY_DELIVERY));
  assert.equal(item.amount, null);
  assert.match(flat(item.title), /≈ 1 652 км/);
  assert.match(item.ask!, /тариф перевозчика, ₽ за км/);
  const old = estimate([]).items.find((i) => i.id === "logistics")!;
  assert.equal(old.kind, "unknown");
  assert.match(old.ask!, /Запросите расчёт у перевозчика/);
});

test("доставка в регион без дороги и доставка без обычного расстояния: просьба запросить маршрут / сумма вне итога", () => {
  const [kam] = deliveryItems(deliveryCost("Москва", "Камчатский край", carrier()));
  assert.equal(kam.amount, null);
  assert.match(kam.ask!, /маршрут и тариф/);
  const [whole] = deliveryItems(deliveryCost("Москва", "Севастополь", carrier()));
  assert.equal(whole.amount, ROAD * 240);
  assert.equal(whole.inTotal, false, "стоимость доставки — затрата для цены, а не потеря");
  assert.deepEqual(deliveryItems(deliveryCost(null, null, carrier())), []);
  assert.deepEqual(fxItems(fxRisk(EMPTY_FX)), []);
});
