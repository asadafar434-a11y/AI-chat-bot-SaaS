import assert from "node:assert/strict";
import { test } from "node:test";
import { CounterpartyError, createCounterpartyLoader } from "./counterparty.ts";
import { handleCounterparty } from "./handler.ts";

// Проверка контрагента без сети: подставной fetch отвечает так, как отвечают реестры (ответы по АО «ДГК», урезаны) — npm test.
const INN = "1434031363";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const EGRUL_ROW = { rows: [{ c: 'АО "ДГК"', g: "ГЕНЕРАЛЬНЫЙ ДИРЕКТОР: Иртов Сергей Викторович", i: INN, k: "ul", n: 'АКЦИОНЕРНОЕ ОБЩЕСТВО "ДАЛЬНЕВОСТОЧНАЯ ГЕНЕРИРУЮЩАЯ КОМПАНИЯ"', o: "1051401746769", p: "272101001", r: "19.12.2005", rn: "Хабаровский край" }] };
const FEDRESURS = { pageData: [{ guid: "10cb58c0-8909-48ba-bb27-985e275180f1", inn: INN, name: 'АО "ДГК"', egrulAddress: "680000, ХАБАРОВСКИЙ КРАЙ", status: "Действующее" }], found: 1 };
const BO_SEARCH = { content: [{ id: 1449769, inn: `<strong>${INN}</strong>`, statusCode: "ACTIVE", index: "680000", region: "ХАБАРОВСКИЙ", city: "ХАБАРОВСК", street: "ФРУНЗЕ", house: "49" }] };
const BO_REPORTS = [{ id: 27055447, period: "2025", actualBfoDate: "2026-03-18", actualCorrectionDate: "2026-03-18" }, { id: 24535060, period: "2024", actualBfoDate: "2025-06-18", actualCorrectionDate: "2025-06-18" }];
const BO_DETAILS = [{ balance: { current1600: 161324221, previous1600: 145863094, beforePrevious1600: 145317541, current1300: 9000000, previous1300: 8000000, beforePrevious1300: 4570355 }, financialResult: { current2110: 140930138, previous2110: 120394401, current2400: 1200000, previous2400: 900000 } }];

type Call = { url: string; method: string; headers: Record<string, string>; body: string };
function registries(over: { egrul?: () => Response; fedresurs?: () => Response; bo?: () => Response } = {}) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: String(init.body ?? "") });
    if (url === "https://egrul.nalog.ru/") return over.egrul ? over.egrul() : json({ t: "AB".repeat(40), captchaRequired: false });
    if (url.startsWith("https://egrul.nalog.ru/search-result/")) return json(EGRUL_ROW);
    if (url.startsWith("https://fedresurs.ru/backend/companies")) return over.fedresurs ? over.fedresurs() : json(FEDRESURS);
    if (url.includes("/advanced-search/organizations/search")) return over.bo ? over.bo() : json(BO_SEARCH);
    if (url.endsWith("/bfo/")) return json(BO_REPORTS);
    if (url.endsWith("/details")) return json(BO_DETAILS);
    return new Response("нет", { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
}

test("три реестра отвечают: отчёт собран, в запросах только ИНН, свежий отчёт ГИР БО выбран по году", async () => {
  const { calls, fetcher } = registries();
  const load = createCounterpartyLoader({ fetcher, now: () => Date.parse("2026-10-25T09:00:00Z") });
  const report = await load(INN);
  assert.equal(report.name, 'АО "ДГК"');
  assert.deepEqual(report.status, { text: "Действующее", tone: "good" });
  assert.equal(report.identity?.headName, "Иртов Сергей Викторович");
  assert.deepEqual(report.statements.map((s) => s.year), [2025, 2024, 2023]);
  assert.equal(report.statements[0].revenue, 140930138);
  assert.ok(Object.values(report.sources).every((s) => s.ok));
  assert.equal(report.cached, false);
  // В реестры ушёл только ИНН; адрес отчёта — свежий (2025), а не 2024.
  const egrulPost = calls.find((c) => c.url === "https://egrul.nalog.ru/")!;
  assert.equal(egrulPost.method, "POST");
  assert.match(egrulPost.body, /query=1434031363/);
  assert.ok(calls.some((c) => c.url === "https://bo.nalog.gov.ru/nbo/bfo/27055447/details"));
  assert.ok(calls.every((c) => /^https:\/\/(egrul\.nalog\.ru|fedresurs\.ru|bo\.nalog\.gov\.ru)\//.test(c.url)), "никаких чужих адресов");
  assert.ok(calls.every((c) => !JSON.stringify(c).includes("@")), "ни почты, ни имени участника");
  assert.match(calls.find((c) => c.url.startsWith("https://fedresurs.ru"))!.headers.Referer, /fedresurs\.ru/);
  // Значения заголовков — только латиница (иначе настоящий fetch падает с ошибкой, а подставной этого не заметит).
  assert.ok(calls.every((c) => Object.values(c.headers).every((v) => /^[\x20-\x7e]*$/.test(v))));
});

test("повторная проверка того же ИНН — из памяти, без запросов к реестрам; неполный ответ в память не кладётся", async () => {
  const first = registries();
  let now = Date.parse("2026-10-25T09:00:00Z");
  const load = createCounterpartyLoader({ fetcher: first.fetcher, now: () => now });
  await load(INN);
  const asked = first.calls.length;
  const again = await load(INN);
  assert.equal(again.cached, true);
  assert.equal(first.calls.length, asked, "второй раз реестры не спрашивали");
  now += 6 * 60 * 60 * 1000 + 1;
  assert.equal((await load(INN)).cached, false, "через шесть часов — заново");

  const broken = registries({ fedresurs: () => json({}, 451) });
  const load2 = createCounterpartyLoader({ fetcher: broken.fetcher, now: () => now });
  const partial = await load2(INN);
  assert.equal(partial.sources.fedresurs?.ok, false);
  const before = broken.calls.length;
  await load2(INN);
  assert.ok(broken.calls.length > before, "после сбоя следующая проверка спрашивает снова");
});

test("один реестр молчит или отказывает — отчёт по остальным, причина названа словами; капчу ЕГРЮЛ программа не обходит", async () => {
  const down = registries({ fedresurs: () => json({}, 451), egrul: () => json({ captchaRequired: true }) });
  const report = await createCounterpartyLoader({ fetcher: down.fetcher })(INN);
  assert.deepEqual(report.sources.fedresurs, { ok: false, reason: "Федресурс отказал в доступе (просит подождать)" });
  assert.deepEqual(report.sources.egrul, { ok: false, reason: "ЕГРЮЛ просит ввести проверочное слово — повторите позже" });
  assert.equal(report.sources.bo?.ok, true);
  assert.equal(report.statements.length > 0, true, "отчётность из ГИР БО на месте");
  assert.equal(down.calls.filter((c) => c.url.startsWith("https://egrul.nalog.ru/search-result")).length, 0, "после капчи результат не запрашивается");
});

test("все три реестра не ответили — понятная ошибка 502, а не пустой отчёт; частые проверки — 429", async () => {
  const dead = (async () => {
    throw new Error("network");
  }) as unknown as typeof fetch;
  await assert.rejects(createCounterpartyLoader({ fetcher: dead })(INN), (e: unknown) => e instanceof CounterpartyError && e.status === 502 && /Реестры сейчас не отвечают/.test(e.message));

  const ok = registries();
  let now = Date.parse("2026-10-25T09:00:00Z");
  const load = createCounterpartyLoader({ fetcher: ok.fetcher, now: () => now, maxPerMinute: 2 });
  await load("7814123727");
  await load("5260200603");
  await assert.rejects(load(INN), (e: unknown) => e instanceof CounterpartyError && e.status === 429);
  now += 61_000;
  await load(INN);
});

const post = (body: unknown) => new Request("http://localhost/api/counterparty", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("маршрут: без входа — отказ; кривой ИНН — 400 с причиной, реестры не спрашиваются; хороший — отчёт", async () => {
  let asked = 0;
  const load = async (inn: string) => {
    asked++;
    return { ...(await createCounterpartyLoader({ fetcher: registries().fetcher })(inn)) };
  };
  const denied = await handleCounterparty(post({ inn: INN }), { authorize: async () => new Response("Требуется вход", { status: 401 }), load });
  assert.equal(denied.status, 401);
  const allow = async () => null;
  const bad = await handleCounterparty(post({ inn: "1434031364" }), { authorize: allow, load });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /Контрольная цифра/);
  assert.equal((await handleCounterparty(post("не json"), { authorize: allow, load })).status, 400);
  assert.equal((await handleCounterparty(post({ inn: 5 }), { authorize: allow, load })).status, 400);
  assert.equal(asked, 0, "реестры не трогали");
  const good = await handleCounterparty(post({ inn: "1434 031 363" }), { authorize: allow, load });
  assert.equal(good.status, 200);
  assert.equal(((await good.json()) as { name: string }).name, 'АО "ДГК"');
  const limited = await handleCounterparty(post({ inn: INN }), { authorize: allow, load: async () => { throw new CounterpartyError("Слишком много проверок подряд", 429); } });
  assert.equal(limited.status, 429);
  const broken = await handleCounterparty(post({ inn: INN }), { authorize: allow, load: async () => { throw new Error("внутренняя ошибка с подробностями"); } });
  assert.equal(broken.status, 502);
  assert.equal(await broken.text(), "Проверка сейчас недоступна. Повторите позже.", "внутренние подробности наружу не идут");
});

// Checko API: ответы по документации api.checko.ru/v2, урезаны до полей, которые читаем.
const CHECKO_COMPANY = {
  data: {
    ОГРН: "1051401746769",
    ИНН: INN,
    КПП: "272101001",
    ДатаРег: "19.12.2005",
    НаимСокр: 'АО "ДГК"',
    НаимПолн: 'АКЦИОНЕРНОЕ ОБЩЕСТВО "ДАЛЬНЕВОСТОЧНАЯ ГЕНЕРИРУЮЩАЯ КОМПАНИЯ"',
    Статус: { Наим: "Действующее" },
    Регион: { Наим: "Хабаровский край" },
    ЮрАдрес: { АдресРФ: "680000, ХАБАРОВСКИЙ КРАЙ, Г. ХАБАРОВСК" },
    Руковод: [{ ФИО: "Иртов Сергей Викторович", НаимДолжн: "Генеральный директор" }],
    Налоги: { ОсобРежим: [], СумУпл: 2304722, СведУплГод: "2025", СумНедоим: 0 },
    РМСП: { Кат: "МИКРОПРЕДПРИЯТИЕ", ДатаВкл: "10.01.2022" },
    СЧР: 9,
    НедобПост: false,
    НедобПостЗап: [],
    ЕФРСБ: [],
    Санкции: false,
    СанкцииСтраны: [],
    СанкцУчр: false,
    Контакты: { Тел: ["+7 495 000-00-00"], Емэйл: ["info@example.ru"], ВебСайт: "https://example.ru" },
  },
  meta: { status: "ok", balance: 1000 },
};
const CHECKO_FINANCES = { data: { "2025": { "2110": 140930138000, "2400": 1200000000, "1600": 161324221000, "1300": 9000000000 } }, meta: { status: "ok" } };
const CHECKO_LEGAL = { data: { ЗапВсего: 1, ОбщСуммИск: 9000, Записи: [{ Номер: "А40-59337/2021", Дата: "2021-03-23", ПрАктив: false, СтрКАД: "https://kad.arbitr.ru/Card/1", СуммИск: 9000, Ист: [{ ИНН: "1027722019555", Наим: "ГУ ГУПФР №3" }], Ответ: [{ ИНН: INN, Наим: 'АО "ДГК"' }] }] } };
const CHECKO_ENFORCEMENTS = { data: { Записи: [{ ИспПрНомер: "111/2021", ИспПрДата: "2021-06-01", ПредмИсп: "Взыскание", СумДолг: 100000, ОстЗадолж: 50000 }] } };
const CHECKO_RELIABILITY = { data: { Масштаб: 14, Номинальность: { Уровень: 1, Наим: "Риск номинальности не выявлен" }, ФинРиски: { Уровень: 1, Наим: "Финансовые риски не выявлены" }, Баланс: { Полож: 92, ТрВним: 8, Негатив: 0 }, Факторы: [{ Тип: "Полож", Текст: "Юридическое лицо зарегистрировано 12 лет назад" }] } };

function checkoApi(over: { company?: () => Response } = {}) {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(url);
    if (url.includes("/company")) return over.company ? over.company() : json(CHECKO_COMPANY);
    if (url.includes("/finances")) return json(CHECKO_FINANCES);
    if (url.includes("/legal-cases")) return json(CHECKO_LEGAL);
    if (url.includes("/enforcements")) return json(CHECKO_ENFORCEMENTS);
    if (url.includes("/reliability")) return json(CHECKO_RELIABILITY);
    return new Response("нет", { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
}

test("ключ Checko: пять запросов к api.checko.ru, отчёт с судами, приставами, надёжностью и контактами, ключ не уходит в ответ и к реестрам не ходим", async () => {
  const { calls, fetcher } = checkoApi();
  const report = await createCounterpartyLoader({ checkoApiKey: "SECRET-KEY", fetcher, now: () => Date.parse("2026-10-25T09:00:00Z") })(INN);
  assert.equal(report.provider, "checko");
  assert.deepEqual(report.sources, { checko: { ok: true } });
  assert.equal(report.name, 'АО "ДГК"');
  assert.deepEqual(report.status, { text: "Действующее", tone: "good" });
  assert.equal(report.statements[0].revenue, 140930138);
  assert.deepEqual([report.courts?.total, report.enforcements?.total], [1, 1]);
  assert.equal(report.reliability?.scale, 14);
  assert.deepEqual(report.contacts, { phones: ["+7 495 000-00-00"], emails: ["info@example.ru"], website: "https://example.ru" });
  assert.deepEqual(report.links.map((l) => l.id), ["fedresurs"]);
  assert.ok(calls.every((u) => u.startsWith("https://api.checko.ru/v2/")));
  assert.ok(calls.every((u) => u.includes("key=SECRET-KEY") && u.includes(`inn=${INN}`)));
  assert.ok(calls.some((u) => u.includes("/company")), "карточка");
  assert.ok(calls.some((u) => u.includes("/finances")), "отчётность");
  assert.ok(calls.some((u) => u.includes("/legal-cases")), "суды");
  assert.ok(calls.some((u) => u.includes("/enforcements")), "приставы");
  assert.ok(calls.some((u) => u.includes("/reliability")), "надёжность");
  assert.ok(!JSON.stringify(report).includes("SECRET-KEY"), "ключ не попадает в отчёт участнику");
});

test("Checko не нашёл организацию — это честное «не найдено», а не сбой: реестры не опрашиваются", async () => {
  const { calls, fetcher } = checkoApi({ company: () => json({ meta: { status: "error", message: "Компания не найдена" } }) });
  const report = await createCounterpartyLoader({ checkoApiKey: "SECRET-KEY", fetcher })(INN);
  assert.deepEqual(report.sources, { checko: { ok: true } });
  assert.equal(report.identity, null);
  assert.equal(calls.every((u) => u.startsWith("https://api.checko.ru/")), true);
});

test("ключ Checko не подошёл или API недоступен — откат на открытые реестры, отчёт всё равно собран", async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(url);
    if (url.startsWith("https://api.checko.ru/")) return json({ meta: { status: "error", message: "Неверный ключ API" } });
    if (url === "https://egrul.nalog.ru/") return json({ t: "AB".repeat(40), captchaRequired: false });
    if (url.startsWith("https://egrul.nalog.ru/search-result/")) return json(EGRUL_ROW);
    if (url.startsWith("https://fedresurs.ru/backend/companies")) return json(FEDRESURS);
    if (url.includes("/advanced-search/organizations/search")) return json(BO_SEARCH);
    if (url.endsWith("/bfo/")) return json(BO_REPORTS);
    if (url.endsWith("/details")) return json(BO_DETAILS);
    return new Response("нет", { status: 404 });
  }) as typeof fetch;

  const logged = console.error;
  console.error = () => {};
  try {
    const report = await createCounterpartyLoader({ checkoApiKey: "BAD", fetcher })(INN);
    assert.equal(report.provider, "direct");
    assert.ok(Object.values(report.sources).every((s) => s?.ok));
    assert.ok(calls.some((u) => u.includes("egrul.nalog.ru")), "после сбоя Checko спросили ЕГРЮЛ");
    assert.ok(!JSON.stringify(report).includes("BAD"), "ключ не попадает в отчёт");
  } finally {
    console.error = logged;
  }
});
