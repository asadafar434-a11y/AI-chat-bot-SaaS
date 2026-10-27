// Зарплата по открытым вакансиям «Работа в России»: ответы подставлены (формат — настоящего API opendata.trudvsem.ru, поля вакансий урезаны) — npm test, сети нет.
import assert from "node:assert/strict";
import { test } from "node:test";
import { REGION_CODE_COUNT, trudvsemRegionCode } from "../../lib/region-codes.ts";
import { REGION_NAMES } from "../../lib/regions.ts";
import { MIN_VACANCIES, officialSalary, vacancySearchTexts } from "./trudvsem.ts";

const vacancy = (name: string, min: number | null, max: number | null, currency = "«руб.»") => ({ vacancy: { "job-name": name, salary_min: min ?? 0, salary_max: max ?? 0, currency, "creation-date": "2026-10-09" } });
const api = (vacancies: unknown[]) => JSON.stringify({ status: "200", meta: { total: vacancies.length, limit: 100 }, results: { vacancies } });
const fetcherOf = (answers: Record<string, string>, calls: string[] = []) =>
  (async (url: string) => {
    calls.push(String(url));
    const key = Object.keys(answers).find((k) => decodeURIComponent(String(url)).includes(k));
    return key ? new Response(answers[key], { status: 200 }) : new Response("нет", { status: 404 });
  }) as unknown as typeof fetch;

test("код региона: у каждого региона из нашего списка есть код; Тверская область — 69", () => {
  assert.equal(trudvsemRegionCode("Тверская область"), "6900000000000");
  assert.equal(trudvsemRegionCode("Москва"), "7700000000000");
  assert.equal(trudvsemRegionCode("Кемеровская область — Кузбасс"), "4200000000000");
  assert.equal(trudvsemRegionCode("Нет такого региона"), null);
  assert.equal(trudvsemRegionCode(null), null);
  assert.deepEqual(REGION_NAMES.filter((n) => !trudvsemRegionCode(n)), [], "ни одного региона без кода");
  assert.equal(REGION_CODE_COUNT, REGION_NAMES.length);
});

test("зарплата кладовщика по вакансиям Тверской области: середина вилки, где есть только «от» — оно, «до» без «от» не берётся; медиана и средние 50 %; пометка с датой", async () => {
  const calls: string[] = [];
  const list = [
    vacancy("Кладовщик", 60000, 80000), // 70 000
    vacancy("Кладовщик", 40000, null), // 40 000
    vacancy("Кладовщик на склад", 50000, 54000), // 52 000
    vacancy("Кладовщик", null, 450000), // только «до» — не берётся
    vacancy("Менеджер по продажам", 90000, 120000), // другая должность
    vacancy("Кладовщик", 45000, 55000, "«USD»"), // не рубли
    vacancy("Старший кладовщик", 65000, 75000), // 70 000
  ];
  const r = await officialSalary({ subject: "Кладовщик", region: "Тверская область" }, "2026-10-27", fetcherOf({ "text=Кладовщик": api(list) }, calls));
  assert.ok(r);
  assert.equal(r.monthly, 61000, "медиана 40 000, 52 000, 70 000, 70 000");
  assert.equal(r.regionMatch, "same");
  assert.equal(r.host, "opendata.trudvsem.ru");
  assert.deepEqual([r.min, r.max], [52000, 70000]);
  assert.match(r.url, /^https:\/\/opendata\.trudvsem\.ru\/api\/v1\/vacancies\/region\/6900000000000\?text=/);
  assert.match(r.quote, /вакансий «Кладовщик» в регионе — 4/);
  assert.match(r.notes.join(" | "), /по 4 вакансиям региона на 27\.10\.2026: объявленная зарплата, не фактическая/);
  assert.equal(calls.length, 1, "первого запроса хватило");
});

test("вакансий меньше трёх, регион не из списка, источник молчит или ответил ошибкой — null (идёт запасной поиск по сайтам); мало по полному названию — пробуем последнее слово", async () => {
  assert.equal(MIN_VACANCIES, 3);
  const few = fetcherOf({ "text=Кладовщик": api([vacancy("Кладовщик", 60000, 80000), vacancy("Кладовщик", 50000, 60000)]) });
  assert.equal(await officialSalary({ subject: "Кладовщик", region: "Тверская область" }, "2026-10-27", few), null);
  const calls: string[] = [];
  assert.equal(await officialSalary({ subject: "Кладовщик", region: "Страна чудес" }, "2026-10-27", fetcherOf({}, calls)), null);
  assert.equal(calls.length, 0, "регион не знаем — источник не спрашиваем");
  const down = (async () => {
    throw new Error("сеть");
  }) as unknown as typeof fetch;
  assert.equal(await officialSalary({ subject: "Кладовщик", region: "Тверская область" }, "2026-10-27", down), null);
  assert.equal(await officialSalary({ subject: "Кладовщик", region: "Тверская область" }, "2026-10-27", fetcherOf({})), null, "404");
  const second: string[] = [];
  const byLastWord = fetcherOf({ "text=Водитель штабелера": api([]), "text=штабелера": api([vacancy("Водитель штабелера", 70000, 90000), vacancy("Водитель штабелера (ричтрака)", 75000, 85000), vacancy("Водитель-штабелер", 60000, 80000)]) }, second);
  const r = await officialSalary({ subject: "Водитель штабелера", region: "Тверская область" }, "2026-10-27", byLastWord);
  assert.ok(r, "по полному названию пусто — по последнему слову нашлось три вакансии");
  assert.equal(second.length, 2);
  assert.equal(r.monthly, 80000);
});

test("слова поиска: полное название без скобок, потом последнее слово, если оно достаточно длинное", () => {
  assert.deepEqual(vacancySearchTexts("Водитель штабелера"), ["Водитель штабелера", "штабелера"]);
  assert.deepEqual(vacancySearchTexts("Кладовщик КРО"), ["Кладовщик КРО", "Кладовщик"], "«КРО» короче пяти знаков — запасное слово «Кладовщик»");
  assert.deepEqual(vacancySearchTexts("Мастер"), ["Мастер"], "одно слово — запасного нет");
  assert.deepEqual(vacancySearchTexts("Руководитель"), ["Руководитель"]);
  assert.deepEqual(vacancySearchTexts("Гидравлическая тележка (рохля)"), ["Гидравлическая тележка", "тележка"]);
});
