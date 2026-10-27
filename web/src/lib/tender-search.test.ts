// Поиск закупок по фильтрам: слова и исключения, закон, цена, даты, «приём заявок идёт», сортировка, ссылка в ЕИС, чтение выгрузки и закладки «Скопировать закупки» — npm test (без сети).
import assert from "node:assert/strict";
import { test } from "node:test";
import { EIS_BOOKMARKLET, EIS_COPY_HEADERS, EIS_EXTRACT } from "./eis-copy-script.ts";
import { importTenders } from "./tender-import.ts";
import { EMPTY_FILTERS, eisOrdersUrl, parseQuery, searchTenders, type TenderFilters, type TenderListing } from "./tender-search.ts";

const TODAY = "2026-10-27";
const L = (over: Partial<TenderListing>): TenderListing => ({ id: "1", law: "44-ФЗ", title: "Поставка угля каменного", customer: "МУП Тепло", price: 1_000_000, publishedAt: "2026-10-20", deadline: "2026-11-05", region: null, method: null, url: null, ...over });
const F = (over: Partial<TenderFilters>): TenderFilters => ({ ...EMPTY_FILTERS, ...over });
const ids = (listings: TenderListing[], filters: TenderFilters, sort: Parameters<typeof searchTenders>[2] = "deadline") => searchTenders(listings, filters, sort, TODAY).items.map((l) => l.id);

test("слова запроса: исключения со знаком «-», фраза в кавычках; поиск по основе слова (поставка → поставке)", () => {
  assert.deepEqual(parseQuery('уголь -ремонт "каменный уголь"'), { include: ["уголь", "каменный уголь"], exclude: ["ремонт"] });
  const list = [L({ id: "a", title: "Поставка каменного угля" }), L({ id: "b", title: "Ремонт котельной, поставка угля" }), L({ id: "c", title: "Услуги по уборке" })];
  assert.deepEqual(ids(list, F({ query: "поставке" })), ["a", "b"], "основа слова");
  assert.deepEqual(ids(list, F({ query: "поставка -ремонт" })), ["a"], "исключение");
  assert.deepEqual(ids(list, F({ query: '"каменного угля"' })), ["a"], "фраза");
  assert.deepEqual(ids(list, F({ query: "уборка уголь" })), [], "все слова обязательны");
  assert.deepEqual(ids(list, F({ query: "" })).length, 3, "пустой запрос — все");
});

test("закон и цена: «оба» — все; закупка без цены при фильтре по цене скрывается и считается", () => {
  const list = [L({ id: "a", law: "44-ФЗ", price: 500_000 }), L({ id: "b", law: "223-ФЗ", price: 2_000_000 }), L({ id: "c", law: null, price: null })];
  assert.deepEqual(ids(list, F({ law: "44" })), ["a"]);
  assert.deepEqual(ids(list, F({ law: "223" })), ["b"]);
  assert.equal(ids(list, F({})).length, 3);
  const r = searchTenders(list, F({ priceFrom: 1_000_000 }), "deadline", TODAY);
  assert.deepEqual(r.items.map((l) => l.id), ["b"]);
  assert.equal(r.hiddenNoPrice, 1);
  assert.deepEqual(ids(list, F({ priceTo: 600_000 })), ["a"]);
});

test("даты: приём заявок идёт (окончание не раньше сегодня; без даты — не прячем); дата размещения от и до", () => {
  const list = [L({ id: "old", deadline: "2026-10-26" }), L({ id: "today", deadline: "2026-10-27" }), L({ id: "none", deadline: null }), L({ id: "late", deadline: "2026-12-01", publishedAt: "2026-09-01" })];
  assert.deepEqual(ids(list, F({ activeOnly: true })).sort(), ["late", "none", "today"]);
  assert.deepEqual(ids(list, F({ activeOnly: false })).sort(), ["late", "none", "old", "today"]);
  assert.deepEqual(ids(list, F({ activeOnly: false, publishedFrom: "2026-10-01" })).sort(), ["none", "old", "today"]);
  assert.deepEqual(ids(list, F({ activeOnly: false, publishedTo: "2026-09-30" })), ["late"]);
});

test("сортировка: скоро заканчивается, новые, дороже, дешевле; без даты и цены — в конце", () => {
  const list = [L({ id: "a", deadline: "2026-11-10", price: 300, publishedAt: "2026-10-01" }), L({ id: "b", deadline: "2026-11-01", price: 900, publishedAt: "2026-10-25" }), L({ id: "c", deadline: null, price: null, publishedAt: null })];
  assert.deepEqual(ids(list, F({}), "deadline"), ["b", "a", "c"]);
  assert.deepEqual(ids(list, F({}), "newest"), ["b", "a", "c"]);
  assert.deepEqual(ids(list, F({}), "priceDesc"), ["b", "a", "c"]);
  assert.deepEqual(ids(list, F({}), "priceAsc"), ["a", "b", "c"]);
});

test("ссылка в ЕИС: параметры формы расширенного поиска (сверены с настоящей страницей 27.10.2026); цена и даты — в ДД.ММ.ГГГГ", () => {
  const url = eisOrdersUrl(F({ query: 'уголь -ремонт "каменный уголь"', law: "any", priceFrom: 100000, priceTo: 5000000, publishedFrom: "2026-10-01" }), TODAY);
  const p = new URL(url).searchParams;
  assert.equal(new URL(url).pathname, "/epz/order/extendedsearch/results.html");
  assert.equal(p.get("searchString"), 'уголь "каменный уголь"', "исключения в ЕИС не уходят");
  assert.equal(p.get("fz44"), "on");
  assert.equal(p.get("fz223"), "on");
  assert.equal(p.get("af"), "on");
  assert.equal(p.get("priceFromGeneral"), "100000");
  assert.equal(p.get("priceToGeneral"), "5000000");
  assert.equal(p.get("currencyIdGeneral"), "-1");
  assert.equal(p.get("publishDateFrom"), "01.10.2026");
  assert.equal(p.get("applSubmissionCloseDateFrom"), "27.10.2026");
  assert.equal(p.get("recordsPerPage"), "_50");
  const only44 = new URL(eisOrdersUrl(F({ law: "44", activeOnly: false }), TODAY)).searchParams;
  assert.equal(only44.get("fz44"), "on");
  assert.equal(only44.get("fz223"), null);
  assert.equal(only44.get("ca"), "on", "не только подача заявок");
  assert.equal(only44.get("applSubmissionCloseDateFrom"), null);
});

const SAMPLE = [
  "Реестровый номер\tЗакон\tСпособ\tНаименование\tЗаказчик\tНМЦК\tДата размещения\tОкончание подачи заявок\tСсылка",
  "32616515024\t223-ФЗ\tИной способ\tРазработка проектной документации\tПАО «Россети»\t3304140,00\t27.10.2026\t06.11.2026\thttps://zakupki.gov.ru/223/purchase/public/purchase/info/common-info.html?regNumber=32616515024",
  "0194200000526005766\t44-ФЗ\tЭлектронный аукцион\tПоставка фармацевтических препаратов\tКОМИТЕТ ПРАВИТЕЛЬСТВА ЧЕЧЕНСКОЙ РЕСПУБЛИКИ\t958753,78\t27.10.2026\t05.11.2026\t",
  "3333\t\t\tБез закона и цены\t\t\t\t\t",
].join("\n");

test("выгрузка из таблицы: столбцы по заголовкам, цена и даты читаются; закон без столбца — по длине номера; повтор пропускается", () => {
  const r = importTenders(SAMPLE + "\n0194200000526005766\t44-ФЗ\tЭлектронный аукцион\tПовтор");
  assert.equal(r.error, undefined);
  assert.equal(r.listings.length, 3);
  assert.deepEqual(r.skipped, [{ line: 5, reason: "повтор" }]);
  const [a, b, c] = r.listings;
  assert.deepEqual([a.id, a.law, a.price, a.publishedAt, a.deadline, a.method], ["32616515024", "223-ФЗ", 3304140, "2026-10-27", "2026-11-06", "Иной способ"]);
  assert.equal(a.customer, "ПАО «Россети»");
  assert.match(a.url ?? "", /regNumber=32616515024/);
  assert.deepEqual([b.law, b.price, b.url], ["44-ФЗ", 958753.78, null]);
  assert.deepEqual([c.law, c.price, c.deadline], [null, null, null], "чего нет в строке — null, не выдумываем");
  const noLaw = importTenders("Реестровый номер;Наименование\n0194200000526005766;Поставка\n32616515024;Услуги");
  assert.deepEqual(noLaw.listings.map((l) => l.law), ["44-ФЗ", "223-ФЗ"]);
});

test("CSV с запятыми и кавычками; нет заголовков — понятная ошибка, а не угадывание", () => {
  const csv = importTenders('Реестровый номер,Наименование,НМЦК\n111,"Закупка, срочная",100000');
  assert.equal(csv.listings[0].title, "Закупка, срочная");
  assert.equal(csv.listings[0].price, 100000);
  assert.match(importTenders("1\t2\t3\n4\t5\t6").error ?? "", /Не нашёл столбцы/);
  assert.match(importTenders("только заголовок").error ?? "", /строка заголовков/);
});

// ——— Закладка «Скопировать закупки»: подставная страница ЕИС ———

type FakeEl = { innerText: string; href?: string; nextElementSibling?: FakeEl | null; querySelector: (s: string) => FakeEl | null; querySelectorAll: (s: string) => FakeEl[] };
const el = (text: string, extra: Partial<FakeEl> = {}): FakeEl => ({ innerText: text, querySelector: () => null, querySelectorAll: () => [], ...extra });
function pairs(titles: [string, string][]): FakeEl[] {
  return titles.map(([t, v]) => el(t, { nextElementSibling: el(v) }));
}
function block(o: { head: string; num: string; href: string; body: [string, string][]; price: string; dates: [string, string][] }): FakeEl {
  const link = el(o.num, { href: o.href });
  const map: Record<string, FakeEl[]> = {
    ".registry-entry__header-top__title": [el(o.head)],
    ".registry-entry__header-mid__number a": [link],
    ".registry-entry__body-title": pairs(o.body),
    ".price-block__value": [el(o.price)],
    ".data-block__title": pairs(o.dates),
  };
  return el("", { querySelector: (s) => map[s]?.[0] ?? null, querySelectorAll: (s) => map[s] ?? [] });
}
const fakeDoc = (blocks: FakeEl[]) => ({ querySelectorAll: (s: string) => (s === ".search-registry-entry-block" ? blocks : []) });
const run = (doc: unknown): string => new Function("doc", `return (${EIS_EXTRACT})(doc)`)(doc);

test("закладка: страница ЕИС → таблица, которую читает выгрузка; пустая страница и чужая разметка — словами, без выдумок", () => {
  const doc = fakeDoc([
    block({ head: "223-ФЗ Иной способ", num: "№ 32616515024", href: "https://zakupki.gov.ru/223/x?regNumber=32616515024", body: [["Объект закупки", "Разработка проектной документации"], ["Заказчик", "ПАО «Россети»"]], price: "3 304 140,00 ₽", dates: [["Размещено", "27.10.2026"], ["Обновлено", "27.10.2026"], ["Окончание подачи заявок", "06.11.2026"]] }),
    block({ head: "44-ФЗ Электронный аукцион", num: "№ 0194200000526005766", href: "https://zakupki.gov.ru/epz/order/y?regNumber=0194200000526005766", body: [["Объект закупки", "Поставка\tпрепаратов"], ["Организация, осуществляющая размещение", "КОМИТЕТ"]], price: "958 753,78 ₽", dates: [["Размещено", "27.10.2026"], ["Окончание подачи заявок", "05.11.2026"]] }),
  ]);
  const text = run(doc);
  assert.equal(text.split("\n")[0], EIS_COPY_HEADERS.join("\t"));
  const imported = importTenders(text);
  assert.equal(imported.error, undefined);
  assert.deepEqual(imported.listings.map((l) => [l.id, l.law, l.price, l.deadline, l.customer, l.method]), [
    ["32616515024", "223-ФЗ", 3304140, "2026-11-06", "ПАО «Россети»", "Иной способ"],
    ["0194200000526005766", "44-ФЗ", 958753.78, "2026-11-05", "КОМИТЕТ", "Электронный аукцион"],
  ]);
  assert.equal(imported.listings[1].title, "Поставка препаратов", "табуляция внутри названия не ломает столбцы");
  assert.match(run(fakeDoc([])), /^!На странице нет списка закупок/);
  assert.match(run(fakeDoc([el("")])), /^!Закупки на странице есть, но прочитать их не вышло/);
  assert.ok(EIS_BOOKMARKLET.startsWith("javascript:(function(){"), "закладка собрана");
  assert.ok(!/\n/.test(EIS_BOOKMARKLET.replace(/\\n/g, "")), "в закладке нет настоящих переводов строк: адрес закладки должен быть в одну строку");
});

test("слова ищутся только в названии: «уголь» не находит заказчика «УГОЛОВНО-ИСПОЛНИТЕЛЬНАЯ ИНСПЕКЦИЯ»; заказчик — отдельным фильтром", () => {
  const list = [
    L({ id: "a", title: "Поставка угля для котельной", customer: "МУП Тепло" }),
    L({ id: "b", title: "Оказание услуг по нанесению символики", customer: 'ФКУ "УГОЛОВНО-ИСПОЛНИТЕЛЬНАЯ ИНСПЕКЦИЯ"' }),
  ];
  assert.deepEqual(ids(list, F({ query: "уголь" })), ["a"]);
  assert.deepEqual(ids(list, F({ customer: "инспекция" })), ["b"]);
  assert.deepEqual(ids(list, F({ query: "поставка", customer: "тепло" })), ["a"]);
});

test("сохранённая выгрузка: испорченные поля не ломают экран, закон и сортировка приводятся к допустимым", async () => {
  const { normalizeTenders } = await import("./tender-store.ts");
  const n = normalizeTenders({
    listings: [{ id: "1", title: "Х", law: "999-ФЗ", price: Number.NaN, deadline: "2026-11-01" }, { title: "без номера" }, null] as never,
    loadedAt: "2026-10-27T10:00:00Z",
    filters: { query: 5, law: "44", priceFrom: "много", customer: "Россети" } as never,
    sort: "странная" as never,
  });
  assert.equal(n.listings.length, 1);
  assert.deepEqual([n.listings[0].law, n.listings[0].price, n.listings[0].deadline, n.listings[0].customer], [null, null, "2026-11-01", null]);
  assert.deepEqual([n.filters.query, n.filters.law, n.filters.priceFrom, n.filters.customer, n.filters.activeOnly], ["", "44", null, "Россети", true]);
  assert.equal(n.sort, "deadline");
});

test("таблица через табуляцию: кавычки внутри названий и заказчика сохраняются", () => {
  const r = importTenders('Реестровый номер\tНаименование\tЗаказчик\n111\tПоставка "Уголь-М" для котельной\tПАО "Россети"');
  assert.equal(r.listings[0].title, 'Поставка "Уголь-М" для котельной');
  assert.equal(r.listings[0].customer, 'ПАО "Россети"');
});
