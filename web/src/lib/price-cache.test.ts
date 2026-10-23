// Живой поиск закупочных цен: выбор позиций, когда искать заново, подпись внизу экрана, разбор запроса — npm test (без сети и денег).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RicPosition } from "./indicative-price.ts";
import { FAILURE_TTL_MS, isFresh, MAX_SEARCH_TRIES, mergeRetry, nextRetryAt, normalizePrices, pickPositions, PRICES_TTL_DAYS, priceSearchFinding, RETRY_AFTER_MS, RETRY_DELAYS_MS, retryKeys, shouldSearch, signatureOf, type SavedPrices } from "./price-cache.ts";
import { liveToLite } from "./market-merge.ts";
import { makeObservation } from "./market-observations.ts";
import { cleanProductName, MAX_PRICE_POSITIONS, parsePricesRequest, searchQueriesFor } from "./prices-request.ts";
import { tokensOf } from "./market-observations.ts";

const pos = (id: string, name: string, qty: string, customerUnit?: number): RicPosition => ({ id, name, unit: "т", qty, analogs: [], ...(customerUnit !== undefined && { customerUnit }) });
const NOW = new Date("2026-10-22T12:00:00Z");
const saved = (over: Partial<SavedPrices> = {}): SavedPrices => ({ at: "2026-10-20T12:00:00Z", signature: "s", results: [], spentRub: 3, ...over });

test("позиции для поиска: самые крупные по сумме (количество × начальная цена за единицу), без суммы — по порядку; не больше шести; пустые названия не берутся", () => {
  const list = [pos("1", "Мелочь", "1", 10), pos("2", "Уголь", "1 500", 5000), pos("3", "Без цены", "100"), pos("4", "Щебень", "200", 900), pos("5", "Песок", "50", 600), pos("6", "Цемент", "10", 4000), pos("7", "", "5", 99)];
  assert.deepEqual(pickPositions(list).map((p) => p.id), ["2", "4", "6", "5", "1", "3"], "по убыванию суммы (7,5 млн, 180 тыс., 40 тыс., 30 тыс., 10), затем без суммы; пустое название не берётся");
  assert.equal(MAX_PRICE_POSITIONS, 6);
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
  assert.equal(found.text, "найдено 3 цены по 2 позициям на 20.10.2026; без цены: 1 позиция; пересчёт — раз в 7 дней");
  assert.equal(found.tone, "good");
  const one = line({ state: "done", saved: saved({ results: [{ key: "a", observations: obs(1), pagesRead: 1, rejected: 0 }] }) });
  assert.match(one.text, /найдено 1 цена по 1 позиции/);
  const none = line({ state: "done", saved: saved({ results: [{ key: "a", observations: [], pagesRead: 4, rejected: 6 }] }) });
  assert.match(none.text, /подходящих цен не нашла \(на 20\.10\.2026, страниц прочитано: 4\)/);
  assert.equal(none.tone, "muted");
});

test("запрос: позиции с названием и единицей, не больше шести; повтор ключа, пустое название, пустой список — отказ; запросы в поиск — без почты и длинных чисел", () => {
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
  assert.match(bad({ positions: Array.from({ length: 7 }, (_, i) => ({ key: String(i), name: "Уголь" })) })!, /не больше 6/);
  assert.deepEqual(searchQueriesFor({ name: "Уголь каменный ДПК", unit: "т", region: "Севастополь" }), ["Уголь каменный ДПК цена за т оптом", "купить Уголь каменный ДПК Севастополь"]);
  assert.deepEqual(searchQueriesFor({ name: "Щебень", unit: "", region: null }), ["Щебень цена оптом", "купить Щебень"]);
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

test("подпись с ценами: если есть строки о ценах по позициям, в подписи видны сами цены (не больше трёх позиций) и дата; нет строк — число найденного", () => {
  const obs = (n: number) => Array.from({ length: n }, (_, i) => ({ priceNoVat: 5000 + i })) as never[];
  const s = saved({ results: [{ key: "a", observations: obs(5), pagesRead: 4, rejected: 1 }] });
  const text = priceSearchFinding({ state: "done", saved: s, highlights: ["«Уголь»: медиана 6 000 ₽, диапазон 5 800 ₽ – 6 200 ₽, цен 5", "«Щебень»: медиана 900 ₽, диапазон 800 ₽ – 1 000 ₽, цен 6", "«Песок»: медиана 1 ₽, диапазон 1 ₽ – 2 ₽, цен 5"] });
  assert.equal(text.text, "«Уголь»: медиана 6 000 ₽, диапазон 5 800 ₽ – 6 200 ₽, цен 5; «Щебень»: медиана 900 ₽, диапазон 800 ₽ – 1 000 ₽, цен 6; «Песок»: медиана 1 ₽, диапазон 1 ₽ – 2 ₽, цен 5 · на 20.10.2026");
  assert.equal(text.tone, "good");
  assert.match(priceSearchFinding({ state: "done", saved: s, highlights: [] }).text, /найдено 5 цен по 1 позиции/);
});

test("подпись внизу: нет позиций, но не хватает файла технических требований — говорит об этом (янтарным), а не «искать нечего»", () => {
  const note = "нет файла «Приложение № 1 — Технические требования»: заказчик приложил его отдельно — добавьте его в закупку";
  assert.deepEqual(priceSearchFinding({ state: "no-positions", note }), { label: "Закупочные цены", text: note, tone: "warn" });
  assert.equal(priceSearchFinding({ state: "no-positions" }).tone, "muted");
});

test("«цена по запросу»: продавцы цену не называют — подпись так и говорит и советует запросить коммерческое предложение; число страниц сохраняется", () => {
  const at = "2026-10-23T08:00:00.000Z";
  const rec = (over: Record<string, unknown>) => ({ key: "p", observations: [], pagesRead: 0, rejected: 0, ...over });
  const text = (results: unknown[]) => priceSearchFinding({ state: "done", saved: { at, signature: "s", results, spentRub: 0 } as never }).text;
  assert.equal(text([rec({ pagesSeen: 9, pagesWithPrice: 0, onRequest: 6 })]), "цены закрыты: у продавцов «цена по запросу» (страниц: 6 из 9, на 23.10.2026) — запросите у них коммерческое предложение");
  // Есть страницы с ценой, но предложения не подошли — обычная подпись, не «цены закрыты».
  assert.match(text([rec({ pagesSeen: 9, pagesWithPrice: 2, onRequest: 4 })]), /подходящих цен в интернете не нашла/);
  assert.equal(normalizePrices({ at, signature: "s", results: [{ key: "p", observations: [], pagesRead: 0, rejected: 0, pagesSeen: 3, onRequest: 2 }] })?.results[0].onRequest, 2);
});

test("«или эквивалент» — слова заказчика, а не название товара: из запроса в поиск, из задания модели и из сравнения названий они убираются", () => {
  assert.equal(cleanProductName("Сварочный агрегат МАКС-300 или эквивалент"), "Сварочный агрегат МАКС-300");
  assert.equal(cleanProductName("Автономный дизельный сварочный агрегат АДД - 2х2501 в УРАЛ или эквивалент"), "Автономный дизельный сварочный агрегат АДД - 2х2501 в УРАЛ");
  assert.equal(cleanProductName("Кабель КГ 3х2,5 (аналог)"), "Кабель КГ 3х2,5");
  assert.equal(cleanProductName("Эквивалент"), "Эквивалент", "если ничего не осталось — название как есть");
  assert.equal(cleanProductName("Щебень гранитный"), "Щебень гранитный");
  assert.deepEqual(searchQueriesFor({ name: "Сварочный агрегат МАКС-300 или эквивалент", unit: "шт", region: null }), ["Сварочный агрегат МАКС-300 цена за шт оптом", "купить Сварочный агрегат МАКС-300"]);
  const parsed = parsePricesRequest({ positions: [{ key: "a", name: "Сварочный агрегат МАКС-300 или эквивалент", unit: "шт" }] });
  assert.ok(parsed.ok);
  assert.equal(parsed.value.positions[0].name, "Сварочный агрегат МАКС-300");
  assert.deepEqual(tokensOf("Агрегат МАКС-300 или эквивалент"), tokensOf("Агрегат МАКС-300"), "для сравнения названий «эквивалент» не слово товара");
});

test("подпись при найденных ценах: по каким позициям цен нет, и намёк на блокировку поиска, если по позиции он ничего не вернул", () => {
  const at = "2026-10-23T08:00:00.000Z";
  const rec = (over: Record<string, unknown>) => ({ key: "p", observations: [], pagesRead: 0, rejected: 0, ...over });
  const o = [{ priceNoVat: 1507504 }] as never[];
  const text = (results: unknown[]) => priceSearchFinding({ state: "done", saved: { at, signature: "s", results, spentRub: 1 } as never }).text;
  assert.equal(text([rec({ observations: o })]), "найдено 1 цена по 1 позиции на 23.10.2026; пересчёт — раз в 7 дней");
  assert.match(text([rec({ observations: o }), rec({ pagesSeen: 8, pagesWithPrice: 3 })]), /на 23\.10\.2026; без цены: 1 позиция; пересчёт/);
  assert.match(text([rec({ observations: o }), rec({ pagesSeen: 0 }), rec({ pagesSeen: 0 })]), /без цены: 2 позиции \(по 2 поиск ничего не вернул — возможно, бесплатный поиск заблокирован\)/);
});

test("подпись «цен не нашла» говорит фактами: сколько страниц просмотрено, на скольких была цена, сколько отклонено и почему; прежние записи — как раньше", () => {
  const at = "2026-10-23T08:00:00.000Z";
  const rec = (over: Record<string, unknown>) => ({ key: "p", observations: [], pagesRead: 0, rejected: 0, ...over });
  const text = (results: unknown[]) => priceSearchFinding({ state: "done", saved: { at, signature: "s", results, spentRub: 1 } as never }).text;
  assert.match(text([rec({ pagesRead: 3, pagesSeen: 10, pagesWithPrice: 3 })]), /подходящих цен в интернете не нашла \(на 23\.10\.2026\): страниц просмотрено 10, с ценой на странице 3$/);
  assert.match(text([rec({ pagesSeen: 8, pagesWithPrice: 0 })]), /страниц просмотрено 8, цены на страницах не выложены/);
  assert.match(text([rec({ pagesRead: 2, pagesSeen: 6, pagesWithPrice: 2, rejected: 1, reasons: ["розничная цена"] }), rec({ pagesSeen: 4, pagesWithPrice: 1 })]), /страниц просмотрено 10, с ценой на странице 3, отклонено 1 \(розничная цена\)/);
  assert.match(text([rec({ pagesRead: 4 })]), /не нашла \(на 23\.10\.2026, страниц прочитано: 4\)/, "запись без новых чисел");
  const kept = normalizePrices({ at, signature: "s", results: [{ key: "p", observations: [], pagesRead: 2, rejected: 1, pagesSeen: 5, pagesWithPrice: 2, reasons: ["розничная цена", 7] }] });
  assert.deepEqual(kept?.results[0].reasons, ["розничная цена"]);
  assert.equal(kept?.results[0].pagesSeen, 5);
});

test("повтор поиска: позиции, по которым не нашлось ни одной страницы (поиск заблокирован), ищутся ещё раз — через десять минут, час и шесть часов, четыре попытки всего; найденное и «страницы были, цены нет» не повторяются", () => {
  const T0 = Date.parse("2026-10-23T07:00:00.000Z");
  const obs = [{ priceNoVat: 1507504 }] as never[];
  const rec = (key: string, over: Record<string, unknown> = {}) => ({ key, observations: [], pagesRead: 0, rejected: 0, ...over });
  const base: SavedPrices = { at: new Date(T0).toISOString(), signature: "s", spentRub: 2.7, results: [rec("a", { pagesSeen: 8 }), rec("b", { observations: obs, pagesSeen: 4 }), rec("c", { pagesSeen: 0 })] };
  const at = (ms: number) => new Date(T0 + ms);
  assert.deepEqual(retryKeys(base, at(RETRY_AFTER_MS - 1000)), [], "десяти минут ещё нет");
  assert.equal(nextRetryAt(base, at(0)), T0 + RETRY_AFTER_MS);
  assert.deepEqual(retryKeys(base, at(RETRY_AFTER_MS)), ["c"], "только позиция без страниц");
  assert.deepEqual(retryKeys({ ...base, results: [rec("a", { pagesSeen: 8 }), rec("b", { observations: obs })] }, at(RETRY_AFTER_MS)), [], "повторять нечего");
  assert.equal(nextRetryAt({ ...base, results: [rec("a", { pagesSeen: 8 })] }, at(0)), null);
  assert.equal(nextRetryAt({ ...base, error: "поиск не ответил" }, at(0)), T0 + RETRY_AFTER_MS, "после неудачи целиком (поиск заблокирован) повтор тоже идёт, в пределах недели");
  const blocked = { ...base, error: "поиск не ответил (просит подтвердить, что вы человек)", results: [rec("c", { pagesSeen: 0 })] };
  assert.deepEqual(retryKeys(blocked, at(RETRY_AFTER_MS)), ["c"]);
  const lifted = mergeRetry(blocked, { at: "x", signature: "s", spentRub: 0.5, results: [rec("c", { observations: obs, pagesSeen: 4 })] }, ["c"], new Date(T0 + RETRY_AFTER_MS).toISOString());
  assert.equal(lifted.error, undefined, "поиск ответил — прежняя неудача снята");
  const still = mergeRetry(blocked, { at: "x", signature: "s", spentRub: 0, error: "поиск не ответил", results: [rec("c", { pagesSeen: 0 })] }, ["c"], new Date(T0 + RETRY_AFTER_MS).toISOString());
  assert.equal(still.error, blocked.error, "ответа нет — неудача остаётся");
  assert.equal(nextRetryAt(base, at(PRICES_TTL_DAYS * 86_400_000 + 1)), null, "старше недели — общий пересчёт");

  const retried = mergeRetry(base, { at: "x", signature: "s", spentRub: 0.4, results: [rec("c", { observations: obs, pagesSeen: 5, pagesRead: 2 })] }, ["c"], new Date(T0 + RETRY_AFTER_MS).toISOString());
  assert.equal(retried.results[1].observations.length, 1, "найденное раньше не тронуто");
  assert.equal(retried.results[2].observations.length, 1, "по повторённой позиции — новый результат");
  assert.equal(retried.results[2].tries, 2);
  assert.equal(retried.spentRub, 3.1);
  assert.equal(retried.retriedAt, new Date(T0 + RETRY_AFTER_MS).toISOString());
  assert.deepEqual(retryKeys(retried, at(2 * RETRY_AFTER_MS)), [], "позиция нашлась — повторять нечего");

  const again = mergeRetry(base, { at: "x", signature: "s", spentRub: 0, results: [rec("c", { pagesSeen: 0 })] }, ["c"], new Date(T0 + RETRY_AFTER_MS).toISOString());
  assert.deepEqual(retryKeys(again, at(RETRY_AFTER_MS + 1)), [], "срок отсчитывается от последнего повтора");
  assert.deepEqual(retryKeys(again, at(RETRY_AFTER_MS + RETRY_DELAYS_MS[1] - 1000)), [], "после второй попытки ждём уже час");
  assert.deepEqual(retryKeys(again, at(RETRY_AFTER_MS + RETRY_DELAYS_MS[1])), ["c"], "через час после повтора — снова");
  const third = mergeRetry(again, { at: "x", signature: "s", spentRub: 0, results: [rec("c", { pagesSeen: 0 })] }, ["c"], new Date(T0 + RETRY_AFTER_MS + RETRY_DELAYS_MS[1]).toISOString());
  assert.equal(third.results[2].tries, 3);
  assert.deepEqual(retryKeys(third, at(RETRY_AFTER_MS + RETRY_DELAYS_MS[1] + RETRY_DELAYS_MS[2] - 1000)), [], "после третьей — ждём шесть часов");
  assert.deepEqual(retryKeys(third, at(RETRY_AFTER_MS + RETRY_DELAYS_MS[1] + RETRY_DELAYS_MS[2])), ["c"]);
  const fourth = mergeRetry(third, { at: "x", signature: "s", spentRub: 0, results: [rec("c", { pagesSeen: 0 })] }, ["c"], new Date(T0 + 7 * 3_600_000).toISOString());
  assert.equal(fourth.results[2].tries, MAX_SEARCH_TRIES);
  assert.deepEqual(retryKeys(fourth, at(10 * 86_400_000 - 1000)), [], "четыре попытки — хватит");
  const failed = mergeRetry(base, { at: "x", signature: "s", spentRub: 0, error: "ИИ на сервере выключен", results: [] }, ["c"], new Date(T0 + RETRY_AFTER_MS).toISOString());
  assert.equal(failed.results[2].tries, 2, "неудача тоже считается попыткой: бесконечных повторов нет");
  assert.equal(normalizePrices({ ...base, retriedAt: "2026-10-23T07:10:00.000Z", results: [rec("c", { pagesSeen: 0, tries: 2 })] })?.results[0].tries, 2);
  assert.equal(normalizePrices({ ...base, retriedAt: "2026-10-23T07:10:00.000Z" })?.retriedAt, "2026-10-23T07:10:00.000Z");
});
