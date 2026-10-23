// Живой поиск закупочных цен: выбор позиций, когда искать заново, подпись внизу экрана, разбор запроса — npm test (без сети и денег).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RicPosition } from "./indicative-price.ts";
import { FAILURE_TTL_MS, isFresh, normalizePrices, pickPositions, PRICES_TTL_DAYS, priceSearchFinding, shouldSearch, signatureOf, type SavedPrices } from "./price-cache.ts";
import { liveToLite } from "./market-merge.ts";
import { makeObservation } from "./market-observations.ts";
import { MAX_PRICE_POSITIONS, parsePricesRequest, searchQueriesFor } from "./prices-request.ts";

const pos = (id: string, name: string, qty: string, customerUnit?: number): RicPosition => ({ id, name, unit: "т", qty, analogs: [], ...(customerUnit !== undefined && { customerUnit }) });
const NOW = new Date("2026-10-22T12:00:00Z");
const saved = (over: Partial<SavedPrices> = {}): SavedPrices => ({ at: "2026-10-20T12:00:00Z", signature: "s", results: [], spentRub: 3, ...over });

test("позиции для поиска: самые крупные по сумме (количество × начальная цена за единицу), без суммы — по порядку; не больше четырёх; пустые названия не берутся", () => {
  const list = [pos("1", "Мелочь", "1", 10), pos("2", "Уголь", "1 500", 5000), pos("3", "Без цены", "100"), pos("4", "Щебень", "200", 900), pos("5", "Песок", "50", 600), pos("6", "Цемент", "10", 4000), pos("7", "", "5", 99)];
  assert.deepEqual(pickPositions(list).map((p) => p.id), ["2", "4", "6", "5"], "по убыванию суммы (7,5 млн, 180 тыс., 40 тыс., 30 тыс.), ровно четыре");
  assert.equal(MAX_PRICE_POSITIONS, 4);
  assert.deepEqual(pickPositions(list, 2).map((p) => p.id), ["2", "4"]);
  assert.deepEqual(pickPositions([pos("a", "Первая", "5"), pos("b", "Вторая", "7")]).map((p) => p.id), ["a", "b"], "суммы нет — как в бланке");
});

test("когда искать: нет сохранённого, позиции изменились, прошла неделя — искать; свежее — нет; после неудачи — не раньше чем через час", () => {
  assert.equal(shouldSearch(null, "s", NOW), true);
  assert.equal(shouldSearch(saved(), "другая", NOW), true, "позиции изменились");
  assert.equal(shouldSearch(saved(), "s", NOW), false, "двое суток назад — ещё годно");
  assert.equal(shouldSearch(saved({ at: "2026-10-14T12:00:00Z" }), "s", NOW), true, "восемь дней — искать заново");
  assert.equal(PRICES_TTL_DAYS, 7);
  assert.equal(shouldSearch(saved({ at: "2026-10-22T11:30:00Z", error: "поиск не ответил" }), "s", NOW), false, "неудача полчаса назад — не повторять");
  assert.equal(shouldSearch(saved({ at: new Date(NOW.getTime() - FAILURE_TTL_MS - 1000).toISOString(), error: "x" }), "s", NOW), true, "час прошёл — можно снова");
  assert.equal(shouldSearch(saved({ at: "не дата" }), "s", NOW), true);
});

test("годность найденного: до недели — годно; неудача и устаревшее — нет; будущая дата — нет", () => {
  assert.equal(isFresh(saved(), NOW), true);
  assert.equal(isFresh(saved({ at: "2026-10-10T00:00:00Z" }), NOW), false);
  assert.equal(isFresh(saved({ error: "поиск не ответил" }), NOW), false);
  assert.equal(isFresh(saved({ at: "2026-10-30T00:00:00Z" }), NOW), false);
  assert.equal(isFresh(null, NOW), false);
});

test("подпись позиций: порядок и регистр названия значения не имеют, изменение названия или единицы — другая подпись", () => {
  const a = [pos("1", "Уголь ДПК", "1"), pos("2", "Щебень", "1")];
  assert.equal(signatureOf(a), signatureOf([pos("1", " уголь дпк ", "9"), pos("2", "ЩЕБЕНЬ", "9")]), "количество в подпись не входит");
  assert.notEqual(signatureOf(a), signatureOf([pos("1", "Уголь ДПК", "1"), pos("2", "Щебень 5-20", "1")]));
  assert.notEqual(signatureOf(a), signatureOf([{ ...a[0], unit: "кг" }, a[1]]));
});

test("подпись внизу экрана: ИИ выключен, позиций нет, идёт поиск, неудача, нашлось и не нашлось — одной строкой и без лишнего", () => {
  const line = (i: Parameters<typeof priceSearchFinding>[0]) => priceSearchFinding(i);
  assert.deepEqual(line({ state: "off" }), { label: "Закупочные цены", text: "ИИ выключен — цены в интернете не искались", tone: "muted" });
  assert.match(line({ state: "no-positions" }).text, /нет списка позиций/);
  assert.equal(line({ state: "searching" }).text, "ищу в интернете…");
  assert.equal(line({ state: "failed", note: "поиск не ответил" }).text, "поиск не ответил");
  assert.match(line({ state: "failed" }).text, /повторю позже/);
  const obs = (n: number) => Array.from({ length: n }, (_, i) => ({ priceNoVat: 5000 + i })) as never[];
  const found = line({ state: "done", saved: saved({ results: [{ key: "a", observations: obs(2), pagesRead: 3, rejected: 1 }, { key: "b", observations: obs(1), pagesRead: 2, rejected: 0 }, { key: "c", observations: [], pagesRead: 1, rejected: 2 }] }) });
  assert.equal(found.text, "найдено 3 цены по 2 позициям на 20.10.2026; пересчёт — раз в 7 дней");
  assert.equal(found.tone, "good");
  const one = line({ state: "done", saved: saved({ results: [{ key: "a", observations: obs(1), pagesRead: 1, rejected: 0 }] }) });
  assert.match(one.text, /найдено 1 цена по 1 позиции/);
  const none = line({ state: "done", saved: saved({ results: [{ key: "a", observations: [], pagesRead: 4, rejected: 6 }] }) });
  assert.match(none.text, /подходящих оптовых цен не нашла \(на 20\.10\.2026, страниц прочитано: 4\)/);
  assert.equal(none.tone, "muted");
});

test("запрос: позиции с названием и единицей, не больше четырёх; повтор ключа, пустое название, пустой список — отказ; запросы в поиск — без почты и длинных чисел", () => {
  const ok = parsePricesRequest({ positions: [{ key: "a", name: "  Уголь   каменный ДПК ", unit: "т", quantity: 1500, region: "Севастополь" }, { name: "Щебень" }] });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value.positions[0], { key: "a", name: "Уголь каменный ДПК", unit: "т", quantity: 1500, region: "Севастополь" });
  assert.equal(ok.value.positions[1].key, "1");
  const bad = (b: unknown) => {
    const r = parsePricesRequest(b);
    return r.ok ? null : r.error;
  };
  assert.match(bad({ positions: [] })!, /Нет позиций/);
  assert.match(bad({ positions: [{ name: "" }] })!, /нет названия/);
  assert.match(bad({ positions: [{ key: "x", name: "Уголь" }, { key: "x", name: "Щебень" }] })!, /повторяется/);
  assert.match(bad({ positions: Array.from({ length: 5 }, (_, i) => ({ key: String(i), name: "Уголь" })) })!, /не больше 4/);
  assert.deepEqual(searchQueriesFor({ name: "Уголь каменный ДПК", unit: "т", region: "Севастополь" }), ["Уголь каменный ДПК цена за т оптом", "купить Уголь каменный ДПК оптом Севастополь"]);
  assert.deepEqual(searchQueriesFor({ name: "Щебень", unit: "", region: null }), ["Щебень цена оптом", "купить Щебень оптом"]);
  assert.deepEqual(searchQueriesFor({ name: "Уголь info@firma.ru 89001234567", unit: "т", region: null }), [], "почта и длинные числа в поиск не уходят");
});

// ——— Найденное при разборе закупки: хранение и превращение в аналоги ———

const liveObs = (price: number, day: string, name = "Уголь каменный ДПК") => {
  const r = makeObservation({ name, unit: "т", price, vat: "without", vatRate: 22, date: day, source: `прайс сайта ${price}`, sourceKind: "price_list" });
  assert.ok(r.ok);
  return r.value;
};

test("сохранённое в браузере: берётся только понятное — повреждённое и чужое отбрасывается, непонятные цены внутри — тоже", () => {
  assert.equal(normalizePrices(null), undefined);
  assert.equal(normalizePrices({ at: 5 }), undefined);
  assert.equal(normalizePrices({ at: "2026-10-22T10:00:00Z", signature: "s" }), undefined);
  const good = { at: "2026-10-22T10:00:00Z", signature: "s", spentRub: 4.2, results: [{ key: "a", observations: [liveObs(5000, "2026-10-22"), { price: 1 }, "мусор"], pagesRead: 3, rejected: 2 }, { key: 7 }, "x"] };
  const n = normalizePrices(good)!;
  assert.equal(n.results.length, 1);
  assert.equal(n.results[0].observations.length, 1);
  assert.equal(n.results[0].pagesRead, 3);
  assert.equal(n.spentRub, 4.2);
  assert.equal(n.error, undefined);
  assert.equal(normalizePrices({ ...good, error: "поиск не ответил" })!.error, "поиск не ответил");
});

test("найденные в интернете цены → аналоги позиции и статистика: по ключу позиции, с тем же отбором сопоставимого, без цен у позиции записи нет", () => {
  const positions = [pos("p1", "Уголь каменный ДПК", "1 500"), pos("p2", "Щебень гранитный", "100")];
  const today = "2026-10-22";
  const obs = [5000, 5100, 5200, 4900, 5050].map((p, i) => liveObs(p, `2026-10-${String(20 - i).padStart(2, "0")}`));
  let n = 0;
  const lite = liveToLite(positions, [{ key: "p1", observations: obs }, { key: "p2", observations: [] }, { key: "нет", observations: obs }], today, () => `l${++n}`);
  assert.equal(lite.length, 1, "у второй позиции цен нет, третьего ключа среди позиций нет");
  assert.equal(lite[0].key, "p1");
  assert.equal(lite[0].analogs.length, 5);
  assert.ok(lite[0].analogs.every((a) => a.vat === "without" && a.source.startsWith("База цен: прайс сайта")));
  assert.equal(lite[0].stats.status, "ok");
  assert.equal(lite[0].stats.median, 5050);
  const other = liveToLite(positions, [{ key: "p1", observations: [liveObs(60, "2026-10-21", "Сахар песок")] }], today, () => "x");
  assert.equal(other[0].analogs.length, 0, "несопоставимое название аналогом не становится");
});

test("подпись с ценами: если есть строки о ценах по позициям, в подписи видны сами цены (не больше двух позиций) и дата; нет строк — число найденного", () => {
  const obs = (n: number) => Array.from({ length: n }, (_, i) => ({ priceNoVat: 5000 + i })) as never[];
  const s = saved({ results: [{ key: "a", observations: obs(5), pagesRead: 4, rejected: 1 }] });
  const text = priceSearchFinding({ state: "done", saved: s, highlights: ["«Уголь»: медиана 6 000 ₽, диапазон 5 800 ₽ – 6 200 ₽, цен 5", "«Щебень»: медиана 900 ₽, диапазон 800 ₽ – 1 000 ₽, цен 6", "«Песок»: медиана 1 ₽, диапазон 1 ₽ – 2 ₽, цен 5"] });
  assert.equal(text.text, "«Уголь»: медиана 6 000 ₽, диапазон 5 800 ₽ – 6 200 ₽, цен 5; «Щебень»: медиана 900 ₽, диапазон 800 ₽ – 1 000 ₽, цен 6 · на 20.10.2026");
  assert.equal(text.tone, "good");
  assert.match(priceSearchFinding({ state: "done", saved: s, highlights: [] }).text, /найдено 5 цен по 1 позиции/);
});

test("подпись внизу: нет позиций, но не хватает файла технических требований — говорит об этом (янтарным), а не «искать нечего»", () => {
  const note = "нет файла «Приложение № 1 — Технические требования»: заказчик приложил его отдельно — добавьте его в закупку";
  assert.deepEqual(priceSearchFinding({ state: "no-positions", note }), { label: "Закупочные цены", text: note, tone: "warn" });
  assert.equal(priceSearchFinding({ state: "no-positions" }).tone, "muted");
});
