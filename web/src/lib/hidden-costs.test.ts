// Скрытые затраты: вид закупки по предмету, регион по адресу, сравнение места поставки с регионом компании, каталог гипотез, допущения и таблица чувствительности — npm test (без ИИ).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractText } from "./extract-text.ts";
import { DEFAULT_DRIVERS, EMPTY_REGISTER, HYPOTHESES, hypothesesFor, lawOf, normalizeRegister, placeOf, regionNote, typeOf } from "./hidden-costs.ts";
import { DEFAULT_ASSUMPTIONS } from "./risk-estimate.ts";
import { regionOf } from "./regions.ts";
import { computeSensitivity } from "./sensitivity.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");

test("вид закупки по предмету: настоящие предметы закупок из папки эталонов", () => {
  assert.equal(typeOf("Поставка угля для нужд котельных"), "goods");
  assert.equal(typeOf("Оказание услуг по организации питания детей в образовательном учреждении"), "food");
  assert.equal(typeOf("Выполнение инженерно-технического обследования и разработку проектно-сметной документации на капитальный ремонт общежития"), "works");
  assert.equal(typeOf("Изготовление товаров (стенд «Автоматизированное исследование двигателя») для оснащения учреждений"), "goods");
  assert.equal(typeOf("Оказание услуг по охране объектов"), "services");
  assert.equal(typeOf("Разработка программного обеспечения для учёта"), "it");
  assert.equal(typeOf("Текущий ремонт помещений"), "works");
  assert.equal(typeOf("Оказание услуг по организации и проведению церемонии награждения"), "services");
  assert.equal(typeOf("Что-то непонятное"), "general");
  assert.equal(typeOf("", ""), "general");
});

test("регион по адресу: название региона, город, область рядом с улицей; улица «Кирова» регион Киров не называет", () => {
  assert.equal(regionOf("Свердловская область, г. Екатеринбург, ул. Мостовая, д. 57")?.name, "Свердловская область");
  assert.equal(regionOf("г. Екатеринбург, ул. Мостовая")?.name, "Свердловская область");
  assert.equal(regionOf("299000, г. Севастополь, ул. Ленина, 1")?.name, "Севастополь");
  assert.equal(regionOf("г. Севастополь")?.hard, true);
  assert.equal(regionOf("Москва, Красная площадь")?.name, "Москва");
  assert.equal(regionOf("Московская область, г. Мытищи")?.name, "Московская область");
  assert.equal(regionOf("г. Томск, ул. Омская")?.name, "Томская область", "«Томск» — Томская область, а не «Омская» внутри слова");
  assert.equal(regionOf("г. Санкт-Петербург, Петродворцовый район")?.name, "Санкт-Петербург");
  assert.equal(regionOf("г. Ростов-на-Дону, ул. Кирова")?.name, "Ростовская область");
  assert.equal(regionOf("ул. Кирова, д. 5"), null);
  assert.equal(regionOf("Камчатский край, г. Петропавловск-Камчатский")?.hard, true);
  assert.equal(regionOf("Республика Татарстан, г. Казань")?.hard, false);
  assert.equal(regionOf(""), null);
});

test("место поставки находится в документах по подписи; регион компании — по юридическому адресу; разные — гипотеза «другой регион» первой в списке", () => {
  const docs = [{ name: "Договор.docx", text: "1.1. Предмет договора.\nМесто поставки: Республика Крым, г. Симферополь, ул. Севастопольская, 10.\nСрок поставки — 30 дней." }];
  const place = placeOf(docs);
  assert.equal(place?.region.name, "Республика Крым");
  assert.match(place!.text, /Место поставки: Республика Крым/);
  const note = regionNote(place, "620000, Свердловская область, г. Екатеринбург");
  assert.equal(note?.kind, "other");
  const list = hypothesesFor("goods", note);
  assert.equal(list[0].id, "region");
  assert.match(list[0].title, /Место поставки — Республика Крым, ваш адрес — Свердловская область/);
  assert.match(list[0].check, /удалённый или с особыми условиями перевозки/);
  assert.equal(list[0].basis, "по месту поставки и вашему адресу");
});

test("тот же регион — гипотезы про регион нет; адрес компании не указан — просьба указать, а не вывод; места поставки нет — ничего", () => {
  const place = placeOf([{ name: "x", text: "Место выполнения работ: г. Екатеринбург, ул. Мостовая, 57" }]);
  assert.equal(regionNote(place, "Свердловская область, г. Екатеринбург, ул. Ленина")?.kind, "same");
  assert.equal(hypothesesFor("works", regionNote(place, "г. Екатеринбург")).some((h) => h.id.startsWith("region")), false);
  const unknown = hypothesesFor("works", regionNote(place, ""));
  assert.equal(unknown[0].id, "region-unknown");
  assert.match(unknown[0].check, /Укажите юридический адрес в «Профиле компании»/);
  assert.equal(placeOf([{ name: "x", text: "Просто текст без места поставки" }]), null);
  assert.equal(regionNote(null, "г. Москва"), null);
  assert.equal(placeOf([{ name: "x", text: "Место поставки: уточняется при заключении договора." }]), null, "регион не назван — не угадываем");
});

test("каталог: для вида закупки — свои гипотезы раньше общих; у каждой название и что проверить; повторов нет", () => {
  const goods = hypothesesFor("goods", null);
  assert.equal(goods[0].id, "logistics");
  assert.ok(goods.some((h) => h.id === "cashgap"));
  assert.ok(!goods.some((h) => h.id === "materials"), "материалы — для работ, не для поставки");
  assert.deepEqual(hypothesesFor("general", null).map((h) => h.id), HYPOTHESES.filter((h) => h.types === "all").map((h) => h.id));
  for (const type of ["goods", "works", "services", "it", "food", "general"] as const) {
    const ids = hypothesesFor(type, null).map((h) => h.id);
    assert.equal(new Set(ids).size, ids.length, `повторы у ${type}`);
    assert.ok(DEFAULT_DRIVERS[type].length >= 2);
  }
  for (const h of HYPOTHESES) {
    assert.ok(h.title.length > 3 && h.check.length > 20 && h.check.length < 260, h.id);
  }
  assert.ok(goods.every((h) => h.basis.length > 0));
});

test("сохранённое по закупке: допущения и своя таблица; повреждённое заменяется безопасным, прежние отметки «учтено» отбрасываются", () => {
  const data = normalizeRegister({
    items: { logistics: { state: "priced", amount: "50 000" } },
    assumptions: { financeRatePct: 18, guaranteeRatePct: "много", delayDays: -5, costSharePct: 70, growthPct: 7, warrantyPct: 1.5, keyRatePct: 15 },
    sens: { price: "1000", cost: "800", drivers: [{ id: "d1", name: "Бензин", amount: "100", shock: "10" }, "мусор", { name: "без id" }] },
  });
  assert.equal(data.assumptions.financeRatePct, 18);
  assert.equal(data.assumptions.guaranteeRatePct, DEFAULT_ASSUMPTIONS.guaranteeRatePct, "не число — по умолчанию");
  assert.equal(data.assumptions.delayDays, DEFAULT_ASSUMPTIONS.delayDays, "отрицательное — по умолчанию");
  assert.equal(data.assumptions.costSharePct, 70);
  assert.equal(data.assumptions.warrantyPct, 1.5);
  assert.equal("items" in data, false);
  assert.equal(data.sens.drivers.length, 1);
  assert.deepEqual(normalizeRegister(null), EMPTY_REGISTER);
  assert.equal(EMPTY_REGISTER.assumptions.financeRatePct, 14, "стоимость денег по умолчанию — ключевая ставка");
});

test("закон закупки по способу; рост цен за срок — по 44-ФЗ твёрдая цена и исключения ст. 95, по 223-ФЗ — смотрите договор, без закона — общий текст", () => {
  assert.equal(lawOf("44-ФЗ · электронный аукцион"), "44");
  assert.equal(lawOf("223-ФЗ · конкурс"), "223");
  assert.equal(lawOf("конкурс"), null);
  const text = (law: "44" | "223" | null) => hypothesesFor("goods", null, law).find((h) => h.id === "price-growth")!.check;
  assert.match(text("44"), /По 44-ФЗ цена контракта твёрдая/);
  assert.match(text("44"), /ст. 95/);
  assert.match(text("44"), /до 30 % после государственной экспертизы и по решению Правительства/);
  assert.match(text("44"), /регулируемых государством тарифов на связь или перевозки/);
  assert.match(text("44"), /уточните у юриста/);
  assert.match(text("223"), /положением о закупке заказчика/);
  assert.match(text(null), /Цена в контракте фиксированная/);
});

test("чувствительность: прибыль, запас роста затрат и «бензин +10 %»; цифры только участника", () => {
  const r = computeSensitivity({
    price: "1 000 000",
    cost: "800 000",
    drivers: [
      { id: "a", name: "Бензин", amount: "200 000", shock: "10" },
      { id: "b", name: "Материалы", amount: "400 000", shock: "5" },
    ],
  });
  assert.equal(r.ready, true);
  assert.equal(r.margin, 200_000);
  assert.equal(r.marginPct, 20);
  assert.equal(r.reserve, 25, "затраты могут вырасти на 25 %, пока прибыль не обнулится");
  assert.deepEqual(r.rows.map((x) => [x.name, x.delta, x.margin]), [["Бензин", 20_000, 180_000], ["Материалы", 20_000, 180_000]]);
  assert.deepEqual(r.total && [r.total.delta, r.total.margin, r.total.marginPct], [40_000, 160_000, 16]);
  assert.deepEqual(r.problems, []);
});

test("чувствительность: нет цены или затрат — «не готово», ничего не выдумывается; убыток; двойной счёт и пропущенный процент — замечания", () => {
  assert.equal(computeSensitivity({ price: "", cost: "100", drivers: [] }).ready, false);
  assert.equal(computeSensitivity({ price: "100", cost: "", drivers: [] }).ready, false);
  assert.equal(computeSensitivity({ price: "abc", cost: "100", drivers: [] }).ready, false);
  const loss = computeSensitivity({ price: "100", cost: "120", drivers: [] });
  assert.equal(loss.margin, -20);
  assert.equal(loss.reserve, 0);
  const bad = computeSensitivity({
    price: "1000",
    cost: "500",
    drivers: [
      { id: "a", name: "Топливо", amount: "400", shock: "" },
      { id: "b", name: "Материалы", amount: "300", shock: "10" },
    ],
  });
  assert.equal(bad.rows.length, 1);
  assert.match(bad.problems.join(" "), /«Топливо»: укажите, на сколько процентов может вырасти/);
  assert.match(bad.problems.join(" "), /Статьи в сумме больше всех затрат/);
  const drop = computeSensitivity({ price: "1000", cost: "800", drivers: [{ id: "a", name: "Курс", amount: "100", shock: "-10" }] });
  assert.equal(drop.rows[0].delta, -10, "падение затрат даёт прибавку");
});

async function placeIn(folder: string) {
  const docs: { name: string; text: string }[] = [];
  for (const name of readdirSync(path.join(ROOT, folder))) {
    if (!/\.(docx|doc|xlsx)$/i.test(name)) continue;
    const r = await extractText(new File([new Uint8Array(readFileSync(path.join(ROOT, folder, name)))], name), { ocr: false });
    if (r.ok) docs.push({ name, text: r.text });
  }
  return placeOf(docs);
}

test("настоящие закупки: место поставки или исполнения читается из документов по подписи — где оно подписано; где нет, честно «не найдено»", async () => {
  assert.equal((await placeIn("Школа № 196 (неконкурентная закупка СМСП)"))?.region.name, "Новосибирская область");
  assert.equal((await placeIn("Комфортная среда (конкурентный отбор 223-ФЗ, обследование и ПИР)"))?.region.name, "Свердловская область");
  assert.equal((await placeIn("Форумная дирекция (конкурс МСП)"))?.region.name, "Смоленская область");
  assert.equal((await placeIn("Воздушные Ворота СС (СМР, склад жидкости, тома проекта)"))?.region.name, "Санкт-Петербург");
  assert.equal((await placeIn("Метрострой СС (аукцион МСП 223-ФЗ, сетка стальная)"))?.region.name, "Санкт-Петербург");
  assert.equal(await placeIn("ДГК (конкурс 223-ФЗ, комплектующие дымососов)"), null, "место поставки в документах не подписано — не угадываем");
});

test("поиски по гипотезам сохраняются и читаются; повреждённое и опасные ссылки отбрасываются", () => {
  assert.deepEqual(EMPTY_REGISTER.searches, {});
  const record = { query: "тарифы на доставку грузов Севастополь 2026", at: "2026-10-21T10:00:00.000Z", provider: "DuckDuckGo", hits: [{ title: "Т", url: "https://a.ru/x", domain: "a.ru", snippet: "с" }] };
  const data = normalizeRegister({ searches: { logistics: record, broken: "x" } });
  assert.deepEqual(data.searches, { logistics: record });
  assert.deepEqual(normalizeRegister({ searches: { logistics: { ...record, hits: [{ title: "Опасная", url: "javascript:alert(1)" }] } } }).searches.logistics.hits, []);
  assert.deepEqual(normalizeRegister({ assumptions: {} }).searches, {}, "прежние данные без поисков читаются");
});
