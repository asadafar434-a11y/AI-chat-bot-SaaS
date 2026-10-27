import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRatePrompt, checkRate, parseRateAnswer, sameSubject, type RateWanted, type RawRate } from "./rate-extract.ts";

const ctx = { url: "https://gorodrabot.ru/salary?p=кладовщик&l=Торжок", title: "Зарплата кладовщика в Торжке", day: "2026-10-27" };
const SALARY: RateWanted = { kind: "salary", subject: "Кладовщик", region: "Тверская область, г. Торжок" };
const raw = (over: Partial<RawRate> = {}): RawRate => ({ subject: "Кладовщик", min: 60000, max: 75000, average: null, period: "month", tax: "net", region: "Торжок", quote: "Кладовщик — зарплата от 60 000 до 75 000 ₽ на руки", ...over });
const page = "Вакансии в Торжке. Кладовщик — зарплата от 60 000 до 75 000 ₽ на руки. Склад, график 2/2.";

test("задание модели: должность и регион названы, указания страницы не исполняются, ответ — только JSON, цитата дословная", () => {
  const p = buildRatePrompt(SALARY, { url: "https://x.ru", title: "Вакансии", text: "текст страницы" });
  assert.match(p, /Нужная должность: «Кладовщик», регион: «Тверская область, г\. Торжок»/);
  assert.match(p, /ДОСЛОВНАЯ цитата/);
  assert.match(p, /<page>\nтекст страницы\n<\/page>/);
  const rent = buildRatePrompt({ kind: "rent", subject: "Ричтрак", region: null }, { url: "https://x.ru", title: "Аренда", text: "т" });
  assert.match(rent, /Нужная техника: «Ричтрак»\./);
  assert.match(rent, /цены АРЕНДЫ \(не продажи\)/);
});

test("ответ модели: берётся первый JSON, мусор и записи без цифр или цитаты отбрасываются, больше шести не берётся", () => {
  const rates = Array.from({ length: 9 }, (_, i) => ({ subject: "Кладовщик", min: 50000 + i, period: "month", quote: "зарплата от 50 000 ₽" }));
  assert.equal(parseRateAnswer(`Вот ответ: ${JSON.stringify({ rates })} конец`).length, 6);
  assert.deepEqual(parseRateAnswer("нет json"), []);
  assert.deepEqual(parseRateAnswer('{"rates": "не список"}'), []);
  assert.deepEqual(parseRateAnswer(JSON.stringify({ rates: [{ subject: "Кладовщик", quote: "без цифр" }, { subject: "К", min: 5 }, { min: 6, quote: "q" }] })), []);
  const one = parseRateAnswer(JSON.stringify({ rates: [{ subject: "Кладовщик", min: "60 000", max: 75000, period: "месяц?", tax: "net", region: null, quote: "от 60 000 до 75 000" }] }))[0];
  assert.deepEqual([one.min, one.max, one.period, one.tax], [60000, 75000, "unknown", "net"]);
});

test("зарплата «на руки» превращается в «до налогов» (÷ 0,87), вилка — по середине, регион совпал; всё названо в пометках", () => {
  const r = checkRate(raw(), page, SALARY, ctx);
  assert.ok(r.ok);
  assert.equal(r.observation.monthly, Math.round(67500 / 0.87));
  assert.deepEqual([r.observation.min, r.observation.max], [Math.round(60000 / 0.87), Math.round(75000 / 0.87)]);
  assert.equal(r.observation.regionMatch, "same");
  assert.match(r.observation.notes.join(" | "), /«на руки» поделена на 0,87/);
  assert.equal(r.observation.host, "gorodrabot.ru");
  assert.equal(r.observation.date, "2026-10-27");
});

test("не принимается: цитаты нет на странице, цифр нет в цитате, другая должность, период не назван и сумма мелкая, нереальная сумма", () => {
  assert.equal(checkRate(raw({ quote: "Кладовщик — зарплата от 61 000 до 75 000 ₽ на руки" }), page, SALARY, ctx).ok, false);
  const wrongNumber = checkRate(raw({ min: 55000 }), page, SALARY, ctx);
  assert.deepEqual(!wrongNumber.ok && wrongNumber.reason, "цифр нет в цитате");
  const wrongRole = checkRate(raw({ subject: "Водитель такси", max: null, quote: "Водитель такси — от 60 000 ₽" }), "Водитель такси — от 60 000 ₽ в месяц", SALARY, ctx);
  assert.deepEqual(!wrongRole.ok && wrongRole.reason, "не та должность или техника");
  const noPeriod = checkRate(raw({ period: "unknown", min: null, max: null, average: 450, quote: "Кладовщик 450 ₽" }), "Кладовщик 450 ₽", SALARY, ctx);
  assert.deepEqual(!noPeriod.ok && noPeriod.reason, "период не назван");
  const absurd = checkRate(raw({ min: null, max: null, average: 9000000, period: "month", quote: "Кладовщик 9 000 000 ₽ в месяц" }), "Кладовщик 9 000 000 ₽ в месяц", SALARY, ctx);
  assert.deepEqual(!absurd.ok && absurd.reason, "сумма не похожа на месячную");
});

test("почасовая и годовая цифры пересчитываются с названным допущением; период не назван, но сумма месячная — принимается с пометкой; налоги не названы — как до налогов", () => {
  const hourly = checkRate(raw({ min: null, max: null, average: 350, period: "hour", tax: "gross", quote: "Кладовщик 350 ₽/час" }), "Кладовщик 350 ₽/час", SALARY, ctx);
  assert.ok(hourly.ok);
  assert.equal(hourly.observation.monthly, 58800, "350 × 168");
  assert.match(hourly.observation.notes.join(" "), /168 часов/);
  const yearly = checkRate(raw({ min: null, max: null, average: 720000, period: "year", tax: "gross", quote: "Кладовщик 720 000 ₽ в год" }), "Кладовщик 720 000 ₽ в год", SALARY, ctx);
  assert.ok(yearly.ok);
  assert.equal(yearly.observation.monthly, 60000);
  const bare = checkRate(raw({ min: 65000, max: null, average: null, period: "unknown", tax: "unknown", quote: "Кладовщик от 65 000 ₽" }), "Кладовщик от 65 000 ₽", SALARY, ctx);
  assert.ok(bare.ok);
  assert.equal(bare.observation.monthly, 65000);
  assert.match(bare.observation.notes.join(" | "), /период на странице не назван — принято как в месяц/);
  assert.match(bare.observation.notes.join(" | "), /налоги на странице не названы/);
  assert.match(bare.observation.notes.join(" | "), /только нижняя граница/);
});

test("регион: чужой регион принимается, но помечается и отличается (в расчёте ему вес меньше); не назван — «unknown»", () => {
  const other = checkRate(raw({ region: "Москва" }), page, SALARY, ctx);
  assert.ok(other.ok);
  assert.equal(other.observation.regionMatch, "other");
  assert.match(other.observation.notes.join(" "), /по другому региону: Москва/);
  const unknown = checkRate(raw({ region: null }), page, SALARY, ctx);
  assert.ok(unknown.ok);
  assert.equal(unknown.observation.regionMatch, "unknown");
});

test("аренда: цена за месяц и за сутки (× 30); страница про продажу — не аренда; НДС не назван — пометка", () => {
  const wanted: RateWanted = { kind: "rent", subject: "Ричтрак", region: "Тверская область" };
  const text = "Аренда ричтрака в Твери — 95 000 ₽ в месяц";
  const month = checkRate({ subject: "Ричтрак", min: null, max: null, average: 95000, period: "month", tax: "unknown", region: "Тверь", quote: text }, text, wanted, { url: "https://arenda.ru/richtrak", title: "Аренда ричтрака", day: "2026-10-27" });
  assert.ok(month.ok);
  assert.equal(month.observation.monthly, 95000);
  assert.match(month.observation.notes.join(" "), /НДС на странице не назван/);
  const day = checkRate({ subject: "Ричтрак", min: null, max: null, average: 4000, period: "day", tax: "net", region: null, quote: "Ричтрак в аренду 4 000 ₽/сутки" }, "Ричтрак в аренду 4 000 ₽/сутки", wanted, { url: "https://a.ru", title: "Ричтрак", day: "2026-10-27" });
  assert.ok(day.ok);
  assert.equal(day.observation.monthly, 120000, "4 000 × 30");
  const sale = checkRate({ subject: "Ричтрак", min: null, max: null, average: 2500000, period: "unknown", tax: "unknown", region: null, quote: "Ричтрак — цена 2 500 000 ₽" }, "Ричтрак — цена 2 500 000 ₽", wanted, { url: "https://b.ru", title: "Купить ричтрак", day: "2026-10-27" });
  assert.deepEqual(!sale.ok && sale.reason, "не аренда");
});

test("живой прогон 27.10.2026: «до 450 000» — потолок вилки, а не зарплата (отклоняется); период берётся из цитаты, если модель его не назвала; почасовая аренда не пересчитывается на месяц", () => {
  const ceiling = checkRate(raw({ min: null, max: 450000, quote: "Кладовщик — зарплата до 450 000 ₽" }), "Кладовщик — зарплата до 450 000 ₽", SALARY, ctx);
  assert.deepEqual(!ceiling.ok && ceiling.reason, "только верхняя граница");
  const salaryMonth = checkRate(raw({ min: null, max: null, average: 65000, period: "unknown", tax: "gross", quote: "Кладовщик — 65 000 руб. в месяц" }), "Кладовщик — 65 000 руб. в месяц", SALARY, ctx);
  assert.ok(salaryMonth.ok);
  assert.ok(!salaryMonth.observation.notes.some((n) => /период на странице не назван/.test(n)), "период названа цитатой «в месяц»");
  const wanted: RateWanted = { kind: "rent", subject: "Ричтрак", region: null };
  const rentCtx = { url: "https://arenda.ru/r", title: "Аренда ричтрака", day: "2026-10-27" };
  const rawRent = (quote: string, average: number): RawRate => ({ subject: "Ричтрак", min: null, max: null, average, period: "unknown", tax: "unknown", region: null, quote });
  const perHour = checkRate(rawRent("Аренда ричтрака 3 250 ₽/час", 3250), "Аренда ричтрака 3 250 ₽/час", wanted, rentCtx);
  assert.deepEqual(!perHour.ok && perHour.reason, "почасовая аренда не подходит");
  const perDay = checkRate(rawRent("Аренда ричтрака — 4 000 ₽ в сутки", 4000), "Аренда ричтрака — 4 000 ₽ в сутки", wanted, rentCtx);
  assert.ok(perDay.ok);
  assert.equal(perDay.observation.monthly, 120000);
  const perMonth = checkRate(rawRent("Ричтрак в аренду от 95 000 руб./мес", 95000), "Ричтрак в аренду от 95 000 руб./мес", wanted, rentCtx);
  assert.ok(perMonth.ok);
  assert.equal(perMonth.observation.monthly, 95000);
});

test("та ли должность: все значимые слова названия есть на странице; «Кладовщик КРО» читается как «Кладовщик»; чужая профессия — нет", () => {
  assert.equal(sameSubject("Оператор склада", "Оператор на складе — зарплата"), true);
  assert.equal(sameSubject("Водитель штабелера", "Водитель штабелера (ричтрака) 80 000 ₽"), true);
  assert.equal(sameSubject("Водитель штабелера", "Водитель такси от 60 000 ₽"), false);
  assert.equal(sameSubject("Кладовщик КРО", "Кладовщик на склад 65 000 ₽"), true, "«КРО» короче четырёх букв — не считается");
  assert.equal(sameSubject("Специалист по транспортной безопасности", "Специалист по транспортной безопасности — 90 000 ₽"), true);
  assert.equal(sameSubject("Руководитель", "Руководитель склада 150 000 ₽"), true);
  assert.equal(sameSubject("ИТ", "что угодно"), false, "нет значимых слов — не сравниваем");
});
