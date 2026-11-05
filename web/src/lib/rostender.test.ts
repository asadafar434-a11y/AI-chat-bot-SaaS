import assert from "node:assert/strict";
import { test } from "node:test";
import { cardToListing, isoOf, parseInfo, parseShortPage, parseTemplates, priceOf, rostenderUrl, safeUrl, textOf } from "./rostender.ts";
import { EMPTY_FILTERS, facetsOf, searchTenders, type TenderListing } from "./tender-search.ts";
import { normalizeTenders } from "./tender-store.ts";

// Ответы Ростендера по описанию rostender.info/docs/api, урезаны до читаемых полей — npm test в web.

const CARD = {
  success: true,
  data: {
    id: 96258725,
    url: "https://rostender.info/tender/96258725",
    dts: "2026-11-05",
    dte: "2026-11-06",
    "dte-formatted": "2026-11-06 17:34:00",
    price: { value: 210000, currency: "RUB", amounts: false },
    type: "44",
    stage: "Приём заявок",
    is_plans: false,
    smp: false,
    plan: null,
    place: "г. Москва;Московская обл;г. Раменское",
    delivery_address: ["Москва и Московская область", "Московская область, г. Раменское, ул. Советская 36а"],
    regions: ["Московская область", "Москва город"],
    cities: [],
    branches: ["Услуги сотовой связи"],
    placement: { title: "Закупки малого объема", source: "" },
    customer: { name: "МБУ «Содержание и благоустройство»", inn: "5040150805", contacts: { person: "МБУ «Содержание и благоустройство»", phone: "", email: "" } },
    descr: "Оказание услуг связи М2М по передаче данных для серверного оборудования (счетчики электроэнергии)",
    positions: [{ name: "Услуги сотовой связи", unit: "мес", price: { sum: 210000, price: 17500, quantity: 12 }, classifier: { OKPD2: ["61.20.11.000"] } }],
    eis: "96258725",
    etp: ["6285497", "3785855", "10831884"],
    links: {
      "16": { id: 1, gid: 16, url: "https://market-lk.rts-tender.ru/x", number: "10831884", title: "РТС-Тендер" },
      "92": { id: 2, gid: 92, url: "https://zakupki.mos.ru/need/6285497", number: "6285497", title: "Портал поставщиков" },
    },
    files: {
      archive: "https://rostender.info/integration/files-archive?t=abc",
      items: [
        { title: "Единые требования.docx", extension: "docx", link: "https://files.rostender.info/?t=1", size: 16240, created_at: "2026-11-06 00:42:15" },
        { title: "Приложение к проекту контракта.zip", extension: "zip", link: "https://files.rostender.info/?t=2", size: 508711 },
        { title: "Страшная ссылка", extension: "js", link: "javascript:alert(1)", size: 1 },
      ],
    },
  },
};

test("число, дата и цена из терпимых форматов; ссылка только http(s)", () => {
  assert.equal(isoOf(1793178000), "2026-10-28");
  assert.equal(isoOf(1793178000000), "2026-10-28", "миллисекунды");
  assert.equal(isoOf("2026-11-05 12:00:00"), "2026-11-05");
  assert.equal(isoOf("05.11.2026"), "2026-11-05");
  assert.equal(isoOf(null), null);
  assert.equal(priceOf({ value: "1 200 000,50", currency: "RUB" }), 1200000.5);
  assert.equal(priceOf(0), null, "ноль — цена не указана");
  assert.equal(priceOf("абв"), null);
  assert.equal(textOf(["Москва", { name: "Тверская область" }]), "Москва, Тверская область");
  assert.equal(safeUrl("https://a.ru/x"), "https://a.ru/x");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("//evil.ru"), null);
});

test("карточка → закупка (по настоящему ответу): главное, закон из type, площадка из links, адрес, документы; чужая ссылка не попадает", () => {
  const l = cardToListing(CARD)!;
  assert.equal(l.id, "rt96258725", "«eis» малой закупки — не номер ЕИС, берём свой номер");
  assert.equal(l.rostenderId, "96258725");
  assert.equal(l.law, "44-ФЗ", "закон — из поля type");
  assert.equal(l.title, "Оказание услуг связи М2М по передаче данных для серверного оборудования (счетчики электроэнергии)");
  assert.equal(l.price, 210000);
  assert.equal(l.publishedAt, "2026-11-05");
  assert.equal(l.deadline, "2026-11-06");
  assert.equal(l.region, "Московская область", "первый регион: по нему строится выпадающий список");
  assert.equal(l.method, "Закупки малого объема");
  assert.equal(l.platform, "РТС-Тендер", "название площадки — из links (в etp лежат только номера)");
  assert.equal(l.stage, "Приём заявок");
  assert.equal(l.smp, false);
  assert.equal(l.customer, "МБУ «Содержание и благоустройство»");
  assert.equal(l.customerInn, "5040150805");
  assert.equal(l.contact, null, "пустые телефон и почта — контакта нет, а название заказчика в «лице» не показываем");
  assert.equal(l.place, "Москва и Московская область");
  assert.equal(l.positionsTotal, 1);
  assert.deepEqual(l.positions?.[0], { name: "Услуги сотовой связи", unit: "мес", price: 210000, quantity: 12, okpd2: "61.20.11.000", ktru: null }, "цена позиции — из объекта {sum, price, quantity}, коды — из classifier");
  assert.equal(l.rev, 2);
  assert.equal(l.docs?.length, 2, "ссылка javascript: отброшена");
  assert.deepEqual(l.docs?.[0], { title: "Единые требования.docx", link: "https://files.rostender.info/?t=1", ext: "docx", size: 16240 });
  assert.equal(l.archive, "https://rostender.info/integration/files-archive?t=abc");
  assert.equal(l.url, "https://rostender.info/tender/96258725", "ссылки в ЕИС нет — карточка Ростендера");
});

test("контакт: имя, телефон и почта берутся, когда они есть; ссылка в ЕИС из links важнее ссылки на Ростендер; номер ЕИС — только настоящий", () => {
  const withEis = cardToListing({
    data: {
      ...CARD.data,
      type: "223",
      eis: "32616523376",
      customer: { name: "МАУК", inn: "5043008324", contacts: { person: "Иванова А.", phone: "+7 496 735-57-22", email: "jul168@yandex.ru" } },
      links: { "1": { url: "https://zakupki.gov.ru/223/purchase/public/notice/view/32616523376", title: "ЕИС" }, "2": { url: "https://x.ru/a", title: "Росэлторг" } },
    },
  })!;
  assert.equal(withEis.id, "32616523376");
  assert.equal(withEis.law, "223-ФЗ");
  assert.equal(withEis.url, "https://zakupki.gov.ru/223/purchase/public/notice/view/32616523376");
  assert.equal(withEis.platform, "ЕИС");
  assert.deepEqual(withEis.contact, { person: "Иванова А.", phone: "+7 496 735-57-22", email: "jul168@yandex.ru" });
  assert.equal(cardToListing({ data: { ...CARD.data, links: { "1": { url: "https://zakupki.gov.ru/x", title: "44-ФЗ ЕИС" } } } })!.platform, "ЕИС", "«44-ФЗ ЕИС» → «ЕИС»");
  const long = cardToListing({ data: { ...CARD.data, type: "44", eis: "0873500002326000924" } })!;
  assert.equal(long.id, "0873500002326000924");
});

test("закон: type «223» — 223-ФЗ, неизвестное и пустое — коммерческая (без закона); карточка без названия и без позиций закупкой не считается", () => {
  assert.equal(cardToListing({ data: { ...CARD.data, type: "223" } })!.law, "223-ФЗ");
  const commercial = cardToListing({ data: { id: 5, descr: "Услуги PR", type: "commercial", eis: null, placement: { title: "Коммерческая закупка" }, url: "https://rostender.info/c" } })!;
  assert.equal(commercial.law, null);
  assert.equal(commercial.id, "rt5", "без номера ЕИС — свой номер");
  assert.equal(cardToListing({ data: { id: 6 } }), null);
  assert.equal(cardToListing({}), null);
  assert.equal(cardToListing("мусор"), null);
  const byNumber = cardToListing({ data: { id: 7, descr: "x", eis: "32616523376" } })!;
  assert.equal(byNumber.law, "223-ФЗ", "type нет — закон по номеру из 11 цифр");
});

test("список: страницы, итого, краткие записи; шаблоны и состояние ключа без самого ключа", () => {
  const page = parseShortPage({ data: [{ id: 1, url: "/tender/1", dts: "2026-11-05 18:14:56", dte: "2026-11-06 17:34:00", price: { value: 5000, currency: "RUB" }, place: "г. Москва", regions: "Московская область", stage: "Приём заявок" }, { nope: true }], _meta: { totalCount: 200, pageCount: 2, currentPage: 1, perPage: 100 } });
  assert.equal(page.items.length, 1);
  assert.deepEqual([page.page, page.pages, page.total], [1, 2, 200]);
  assert.equal(page.items[0].deadline, "2026-11-06");
  assert.equal(page.items[0].url, "https://rostender.info/tender/1", "относительная ссылка списка — на сайт Ростендера");
  assert.equal(page.items[0].region, "Московская область");
  assert.equal(rostenderUrl("//evil.ru/x"), null, "«//чужой.сайт» не принимается");
  assert.equal(rostenderUrl("javascript:alert(1)"), null);
  assert.deepEqual(parseTemplates({ data: [{ id: 7, name: "Короткие тендеры", shared: 0 }, { id: 8 }] }), [{ id: "7", title: "Короткие тендеры" }, { id: "8", title: "Шаблон 8" }]);
  const info = parseInfo({ data: { client_id: 1, current_api_key: "СЕКРЕТ", daily_limit: 100, used_today: 12, remaining: 88, resets_at: "2026-11-06 00:00:00", api_keys: ["СЕКРЕТ"] } });
  assert.deepEqual(info, { limit: 100, used: 12, remaining: 88, resetsAt: "2026-11-06 00:00:00" });
  assert.equal(JSON.stringify(info).includes("СЕКРЕТ"), false);
});

test("фильтры под карточки Ростендера: МСП, есть документы, площадка, «заканчивается за N дней», коммерческие; ЕИС-выгрузка работает как раньше", () => {
  const base = { law: null, title: "x", customer: null, price: 1, publishedAt: null, region: null, method: null, url: null } as const;
  const a: TenderListing = { ...base, id: "a", law: "44-ФЗ", deadline: "2026-11-06", region: "Москва", source: "rostender", smp: true, platform: "ЕИС", docs: [{ title: "д", link: "https://x.ru/1", ext: "pdf", size: 1 }] };
  const b: TenderListing = { ...base, id: "b", law: "223-ФЗ", deadline: "2026-11-20", region: "Тверская область", source: "rostender", smp: false, platform: "РТС-тендер", docs: [] };
  const c: TenderListing = { ...base, id: "c", law: null, deadline: "2026-11-05", region: "Москва", source: "rostender", smp: null, platform: "Росэлторг", docs: [{ title: "д", link: "https://x.ru/2", ext: null, size: null }] };
  const eis: TenderListing = { ...base, id: "e", law: "44-ФЗ", deadline: "2026-11-30" };
  const all = [a, b, c, eis];
  const ids = (patch: Partial<typeof EMPTY_FILTERS>) => searchTenders(all, { ...EMPTY_FILTERS, ...patch }, "deadline", "2026-11-05").items.map((x) => x.id);
  assert.deepEqual(ids({}), ["c", "a", "b", "e"], "без фильтров — все, по сроку");
  assert.deepEqual(ids({ smp: true }), ["a"]);
  assert.deepEqual(ids({ withDocs: true }), ["c", "a"]);
  assert.deepEqual(ids({ platform: "РТС-тендер" }), ["b"]);
  assert.deepEqual(ids({ law: "commercial" }), ["c"]);
  assert.deepEqual(ids({ law: "44" }), ["a", "e"]);
  assert.deepEqual(ids({ daysLeft: 3 }), ["c", "a"], "до 7 ноября включительно: сегодня 5-го, завтра 6-го и 7-го");
  assert.deepEqual(ids({ daysLeft: 1 }), ["c"], "только сегодня");
  assert.deepEqual(ids({ region: "Москва", withDocs: true, daysLeft: 7 }), ["c", "a"], "фильтры складываются");
  const f = facetsOf(all);
  assert.deepEqual(f.regions[0], { value: "Москва", count: 2 });
  assert.deepEqual(f.platforms.map((x) => x.value).sort(), ["ЕИС", "РТС-тендер", "Росэлторг"]);
});

test("хранилище: поля Ростендера сохраняются, мусор отбрасывается, закупки из ЕИС остаются как были, старые фильтры дополняются", () => {
  const listing = cardToListing({ data: { ...CARD.data, customer: { name: "МБУ", inn: "5040150805", contacts: { person: "Иванова А.", phone: "+7 495 000-00-00", email: "zakaz@example.ru" } } } })!;
  const saved = normalizeTenders({
    listings: [
      { ...listing, docs: [...(listing.docs ?? []), { title: "x", link: "javascript:1", ext: null, size: null }] },
      { id: "eis-1", law: "223-ФЗ", title: "из ЕИС", customer: null, price: 5, publishedAt: null, deadline: null, region: null, method: null, url: null, docs: [{ title: "лишнее", link: "https://x", ext: null, size: null }] },
    ],
    loadedAt: "2026-11-05T10:00:00Z",
    filters: { ...EMPTY_FILTERS, law: "commercial", smp: true, daysLeft: 3 },
    sort: "deadline",
  });
  const first = saved.listings[0];
  assert.equal(first.docs?.length, 2, "ссылка javascript: не доживает до хранилища");
  assert.equal(first.contact?.phone, "+7 495 000-00-00");
  assert.equal(first.smp, false, "false сохраняется как false, а не пропадает");
  assert.equal(saved.listings[1].docs, undefined, "у закупки из ЕИС полей Ростендера нет");
  assert.deepEqual([saved.filters.law, saved.filters.smp, saved.filters.daysLeft], ["commercial", true, 3]);
  const old = normalizeTenders({ listings: [], loadedAt: "", filters: { query: "уголь", law: "44" } as never, sort: "newest" });
  assert.deepEqual([old.filters.smp, old.filters.withDocs, old.filters.platform, old.filters.daysLeft], [false, false, "", null], "прежнее сохранённое получает пустые новые фильтры");
});
