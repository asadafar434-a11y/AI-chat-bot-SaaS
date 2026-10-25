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
  assert.equal(partial.sources.fedresurs.ok, false);
  const before = broken.calls.length;
  await load2(INN);
  assert.ok(broken.calls.length > before, "после сбоя следующая проверка спрашивает снова");
});

test("один реестр молчит или отказывает — отчёт по остальным, причина названа словами; капчу ЕГРЮЛ программа не обходит", async () => {
  const down = registries({ fedresurs: () => json({}, 451), egrul: () => json({ captchaRequired: true }) });
  const report = await createCounterpartyLoader({ fetcher: down.fetcher })(INN);
  assert.deepEqual(report.sources.fedresurs, { ok: false, reason: "Федресурс отказал в доступе (просит подождать)" });
  assert.deepEqual(report.sources.egrul, { ok: false, reason: "ЕГРЮЛ просит ввести проверочное слово — повторите позже" });
  assert.equal(report.sources.bo.ok, true);
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
