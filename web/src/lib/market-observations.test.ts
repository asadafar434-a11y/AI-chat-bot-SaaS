// Рыночные ценовые наблюдения: нормализация, сопоставимость, статистика только при достаточных данных, загрузка из таблицы — npm test (без базы и сети).
import assert from "node:assert/strict";
import { test } from "node:test";
import { analogsFrom, comparable, hashOf, isSourceKind, keyOf, makeObservation, MARKET_METHOD, marketStats, normalizeUnit, observationsFromTable, tokensOf, type Observation } from "./market-observations.ts";

const obs = (name: string, price: number, date: string, over: Partial<Parameters<typeof makeObservation>[0]> = {}): Observation => {
  const built = makeObservation({ name, unit: "т", price, vat: "without", vatRate: 22, date, source: `прайс поставщика № ${Math.round(price)}-${date}`, sourceKind: "price_list", ...over });
  assert.ok(built.ok, built.ok ? "" : built.reason);
  return built.value;
};
const COAL = { name: "Уголь ДПК", unit: "т" };
const ON = "2026-10-22";

test("единицы приводятся к короткой форме; слова названия — в основы без падежей, цифры целиком, ключ не зависит от порядка слов", () => {
  assert.equal(normalizeUnit("Тонна"), "т");
  assert.equal(normalizeUnit("кв. м"), "м2");
  assert.equal(normalizeUnit("шт."), "шт");
  assert.equal(normalizeUnit(""), "");
  assert.deepEqual(tokensOf("Уголь каменного марки ДПК 100"), tokensOf("каменный уголь ДПК 100"));
  assert.ok(tokensOf("Кабель 3×2,5 мм").includes("2.5"));
  assert.equal(keyOf("Уголь ДПК", "тонна"), keyOf("уголь дпк", "т"));
});

test("наблюдение: цена с НДС приводится к цене без НДС; нет даты, источника или цены — наблюдения нет с понятной причиной", () => {
  const withVat = makeObservation({ name: "Уголь ДПК", unit: "т", price: 6100, vat: "with", vatRate: 22, date: "2026-09-01", source: "прайс поставщика № 1", sourceKind: "price_list" });
  assert.ok(withVat.ok && withVat.value.priceNoVat === 5000);
  const reason = (over: object) => {
    const r = makeObservation({ name: "Уголь ДПК", unit: "т", price: 5000, vat: "without", vatRate: 22, date: "2026-09-01", source: "прайс", sourceKind: "price_list", ...over });
    return r.ok ? null : r.reason;
  };
  assert.match(reason({ date: "" })!, /нет даты цены/);
  assert.match(reason({ date: "01.09.2026" })!, /нет даты цены/);
  assert.match(reason({ source: "  " })!, /не назван источник/);
  assert.match(reason({ price: 0 })!, /цена не число/);
  assert.match(reason({ price: Number.NaN })!, /цена не число/);
  assert.match(reason({ name: "" })!, /нет названия/);
  assert.equal(reason({}), null);
});

test("повтор распознаётся по ключу, цене, дате и источнику; другая цена или дата — другое наблюдение", () => {
  const a = obs("Уголь ДПК", 5000, "2026-09-01", { source: "прайс поставщика № 1" });
  const same = obs("уголь  дпк", 5000, "2026-09-01", { source: "прайс  поставщика № 1" });
  assert.equal(a.hash, same.hash);
  assert.notEqual(a.hash, obs("Уголь ДПК", 5001, "2026-09-01", { source: "прайс поставщика № 1" }).hash);
  assert.notEqual(a.hash, obs("Уголь ДПК", 5000, "2026-09-02", { source: "прайс поставщика № 1" }).hash);
  assert.equal(hashOf(a), a.hash);
});

test("сопоставимость: та же единица, те же цифры в названии, похожие слова, объёмы не более чем втрое различаются", () => {
  const o = obs("Уголь каменный марки ДПК", 5000, "2026-09-01", { quantity: 100 });
  assert.deepEqual(comparable({ ...COAL, quantity: 150 }, o), { ok: true });
  assert.deepEqual(comparable({ name: "Каменный уголь ДПК", unit: "тонна" }, o), { ok: true }, "порядок слов, окончания и слово «марки» не мешают");
  assert.deepEqual(comparable({ ...COAL, unit: "кг" }, o), { ok: false, reason: "unit" });
  assert.deepEqual(comparable({ ...COAL, quantity: 1000 }, o), { ok: false, reason: "volume" });
  assert.deepEqual(comparable({ name: "Сахар песок", unit: "т" }, o), { ok: false, reason: "words" });
  const cable = obs("Кабель ВВГ 3x2.5", 90, "2026-09-01", { unit: "м" });
  assert.deepEqual(comparable({ name: "Кабель ВВГ 3x4", unit: "м" }, cable), { ok: false, reason: "characteristics" }, "другая цифра в названии — другая позиция");
  assert.deepEqual(comparable({ name: "Кабель ВВГ 3x2,5", unit: "м" }, cable), { ok: true });
});

test("статистика: меньше пяти сопоставимых цен — «недостаточно данных» с причиной, чисел нет; цены вне окна называются отдельно", () => {
  const few = [obs("Уголь ДПК", 5000, "2026-09-01"), obs("Уголь ДПК", 5100, "2026-08-01"), obs("Уголь ДПК", 4900, "2025-01-01")];
  const s = marketStats(COAL, few, ON);
  assert.equal(s.status, "insufficient");
  assert.equal(s.median, null);
  assert.equal(s.range, null);
  assert.match(s.missing[0], /нужно не меньше 5 сопоставимых цен за 365 дней, найдено 2/);
  assert.match(s.missing[1], /ещё 1 цен вне окна/);
});

test("статистика: среднее, медиана, диапазон (минимум–максимум до десяти цен), число цен, источники и даты", () => {
  const list = [5000, 5100, 5200, 4900, 5000].map((p, i) => obs("Уголь ДПК", p, `2026-0${i + 4}-15`));
  const s = marketStats(COAL, list, ON);
  assert.equal(s.status, "ok");
  assert.equal(s.n, 5);
  assert.equal(s.median, 5000);
  assert.equal(Math.round(s.mean!), 5040);
  assert.deepEqual(s.range, { from: 4900, to: 5200 });
  assert.equal(s.sources.length, 5);
  assert.deepEqual(s.dates, { from: "2026-04-15", to: "2026-08-15" });
  assert.ok(s.cv! < 0.05);
});

test("статистика: при десяти и больше ценах диапазон — от 10-го до 90-го процентиля, одиночный выброс его не растягивает", () => {
  const prices = [5000, 5010, 5020, 5030, 5040, 5050, 5060, 5070, 5080, 20000];
  const list = prices.map((p, i) => obs("Уголь ДПК", p, `2026-0${(i % 6) + 3}-${10 + i}`));
  const s = marketStats(COAL, list, ON);
  assert.equal(s.n, 10);
  assert.ok(s.range!.to < 20000, `верх диапазона ${s.range!.to}`);
  assert.ok(s.range!.from >= 5000);
});

test("статистика: неоднородные цены (вариация выше 33 %) — числа есть, но статус «неоднородны» и причина", () => {
  const list = [3000, 4000, 5000, 9000, 12000].map((p, i) => obs("Уголь ДПК", p, `2026-0${i + 4}-10`));
  const s = marketStats(COAL, list, ON);
  assert.equal(s.status, "heterogeneous");
  assert.match(s.missing[0], /цены неоднородны/);
  assert.ok(s.median !== null);
});

test("динамика: недавние цены против прежних — только если в каждой части не меньше трёх цен; рост в процентах по медианам", () => {
  const recent = [6000, 6100, 6200].map((p, i) => obs("Уголь ДПК", p, `2026-09-0${i + 1}`));
  const earlier = [5000, 5000, 5000].map((p, i) => obs("Уголь ДПК", p, `2025-12-0${i + 1}`));
  const s = marketStats(COAL, [...recent, ...earlier], ON);
  assert.equal(s.status, "ok");
  assert.equal(s.dynamics!.recent.median, 6100);
  assert.equal(s.dynamics!.earlier.median, 5000);
  assert.equal(Math.round(s.dynamics!.changePct * 10) / 10, 22);
  const noEarlier = marketStats(COAL, [...recent, obs("Уголь ДПК", 5000, "2026-05-01"), obs("Уголь ДПК", 5000, "2026-06-01")], ON);
  assert.equal(noEarlier.dynamics, null, "прежних цен меньше трёх — динамики нет");
});

test("регионы: только где не меньше трёх цен; разница с общей медианой; регион закупки найден — своя строка, нет данных — null", () => {
  const mk = (region: string, price: number, day: number) => obs("Уголь ДПК", price, `2026-09-${String(day).padStart(2, "0")}`, { region });
  const list = [mk("Севастополь", 5000, 1), mk("Севастополь", 5100, 2), mk("Севастополь", 5200, 3), mk("Камчатский край", 9000, 4), mk("Камчатский край", 9100, 5), mk("Камчатский край", 9200, 6), mk("Тула", 4000, 7), mk("Тула", 4100, 8)];
  const s = marketStats({ ...COAL, region: "Камчатский край" }, list, ON);
  assert.deepEqual(s.regional.map((r) => r.region).sort(), ["Камчатский край", "Севастополь"], "в Туле две цены — региона в списке нет");
  assert.ok(s.targetRegion && s.targetRegion.diffPct > 0, "Камчатка дороже общей медианы");
  assert.equal(marketStats({ ...COAL, region: "Тула" }, list, ON).targetRegion, null);
});

test("в расчёт идут только цены не позже даты расчёта и не старше окна; будущие и старые отбрасываются", () => {
  const list = [obs("Уголь ДПК", 5000, "2026-11-01"), obs("Уголь ДПК", 5000, "2024-01-01"), ...[1, 2, 3, 4, 5].map((i) => obs("Уголь ДПК", 5000 + i, `2026-07-0${i}`))];
  const s = marketStats(COAL, list, ON);
  assert.equal(s.n, 5);
  assert.equal(MARKET_METHOD.windowDays, 365);
});

test("аналоги для РИЦ: без НДС, с источником «База цен: …» и датой, свежие первыми; несопоставимое не попадает", () => {
  const list = [obs("Уголь ДПК", 5000, "2026-09-01"), obs("Уголь ДПК", 5100, "2026-09-10"), obs("Сахар песок", 60, "2026-09-10")];
  let n = 0;
  const analogs = analogsFrom(COAL, list, ON, () => `a${++n}`);
  assert.equal(analogs.length, 2);
  assert.equal(analogs[0].date, "2026-09-10");
  assert.ok(analogs.every((a) => a.vat === "without" && a.source.startsWith("База цен: прайс поставщика №")));
});

test("загрузка из таблицы: название, цена и дата обязательны; НДС из ячейки или по умолчанию; источник — из ячейки или «файл, строка»; повтор и строки без даты или цены — с причиной", () => {
  const text = [
    "Наименование;Цена за единицу;Дата;НДС;Источник",
    "Уголь каменный ДПК;6 100,00;01.09.2026;с НДС;Прайс ООО Уголь-Опт от 01.09.2026",
    "Уголь каменный ДПК;6 100,00;01.09.2026;с НДС;Прайс ООО Уголь-Опт от 01.09.2026",
    "Уголь каменный ДПК;5 000,00;02.09.2026;без НДС;",
    "Уголь каменный ДПК;4 900,00;;без НДС;",
    "Уголь каменный ДПК;;03.09.2026;без НДС;",
  ].join("\n");
  const { observations, skipped } = observationsFromTable(text, { source: "прайс.csv", sourceKind: "price_list", unit: "тонна", defaultVat: "without", vatRate: 22 });
  assert.equal(observations.length, 2);
  assert.equal(observations[0].priceNoVat, 5000, "6 100 с НДС 22 % = 5 000 без НДС");
  assert.equal(observations[0].source, "Прайс ООО Уголь-Опт от 01.09.2026");
  assert.equal(observations[0].unit, "т");
  assert.equal(observations[1].source, "прайс.csv, строка 4", "без своего источника — файл и строка");
  assert.deepEqual(skipped.map((x) => x.reason), ["повтор в файле: такая же цена, дата и источник", "нет даты цены", "цена за единицу не найдена"]);
});

test("закупочная цена и только она: цена контракта (реестр ЕИС, номер контракта из 19 цифр, итоги торгов) не принимается ни одной строкой — в ней маржа победителя", () => {
  const make = (source: string) => makeObservation({ name: "Уголь ДПК", unit: "т", price: 5000, vat: "without", vatRate: 22, date: "2026-09-01", source, sourceKind: "price_list" });
  for (const source of ["ЕИС, контракт № 1234567890123456789", "реестр контрактов, выгрузка 22.10.2026", "1234567890123456789", "протокол подведения итогов", "https://zakupki.gov.ru/epz/contract/x"]) {
    const r = make(source);
    assert.ok(!r.ok, source);
    assert.match(r.ok ? "" : r.reason, /цена контракта — в ней маржа победителя; нужна закупочная цена/);
  }
  assert.ok(make("Прайс ООО Уголь-Опт от 01.09.2026").ok);
  assert.ok(make("коммерческое предложение ООО Тепло-Снаб № 15 от 01.09.2026").ok, "предложение поставщика — закупочная цена");
  const table = observationsFromTable(["Наименование;Цена;Дата;Источник", "Уголь ДПК;5000;01.09.2026;1234567890123456789", "Уголь ДПК;5100;02.09.2026;Прайс Уголь-Опт"].join("\n"), { source: "файл.csv", sourceKind: "price_list", unit: "т", defaultVat: "without" });
  assert.equal(table.observations.length, 1);
  assert.match(table.skipped[0].reason, /цена контракта/);
  const whole = observationsFromTable("Наименование;Цена;Дата\nУголь ДПК;5000;01.09.2026", { source: "ЕИС, реестр контрактов", sourceKind: "price_list", unit: "т", defaultVat: "without" });
  assert.equal(whole.observations.length, 0, "источник файла — реестр контрактов: ни одна строка не принимается");
  assert.equal(isSourceKind("price_list") && isSourceKind("supplier_offer") && isSourceKind("exchange") && isSourceKind("other"), true);
  assert.equal(isSourceKind("eis_contract"), false, "вида «контракт ЕИС» больше нет");
});
