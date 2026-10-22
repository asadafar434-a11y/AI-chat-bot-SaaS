// Курсы Банка России за год: запрос на cbr.ru только с номером валюты из нашего списка и датами, память на час, понятные отказы — npm test (без сети).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCbrLoader, CbrError } from "./cbr.ts";
import { handleCbr, type CbrDeps } from "./handler.ts";

const xml = (rows: [string, string][], id = "R01235") =>
  `<?xml version="1.0" encoding="windows-1251"?><ValCurs ID="${id}" name="Foreign Currency Market Dynamic">${rows
    .map(([d, v]) => `<Record Date="${d}" Id="${id}"><Nominal>1</Nominal><Value>${v}</Value><VunitRate>${v}</VunitRate></Record>`)
    .join("")}</ValCurs>`;

const ROWS: [string, string][] = [
  ["21.10.2026", "82,8879"],
  ["22.10.2026", "81,9739"],
];

function fakeFetch(respond: (n: number) => Response | Promise<Response>) {
  const urls: string[] = [];
  const fetcher = (async (input: unknown) => {
    urls.push(String(input));
    return respond(urls.length);
  }) as unknown as typeof fetch;
  return { fetcher, urls };
}
const ok = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "application/xml" } });
const NOW = Date.parse("2026-10-22T09:00:00Z");

test("курсы: запрос идёт на cbr.ru с номером валюты R01235 и датами за год, ответ разобран по возрастанию дат", async () => {
  const { fetcher, urls } = fakeFetch(() => ok(xml(ROWS)));
  const load = createCbrLoader({ fetcher, now: () => NOW });
  const out = await load("USD");
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/www\.cbr\.ru\/scripts\/XML_dynamic\.asp\?date_req1=\d{2}\/\d{2}\/2025&date_req2=22\/10\/2026&VAL_NM_RQ=R01235$/);
  assert.equal(out.name, "Доллар США");
  assert.deepEqual(out.points, [
    { date: "2026-10-21", rate: 82.8879 },
    { date: "2026-10-22", rate: 81.9739 },
  ]);
  assert.equal(out.cached, false);
});

test("курсы: повторный запрос в течение часа берётся из памяти, через час — снова с cbr.ru; у евро и юаня свои номера", async () => {
  let t = NOW;
  const { fetcher, urls } = fakeFetch(() => ok(xml(ROWS)));
  const load = createCbrLoader({ fetcher, now: () => t });
  await load("USD");
  const again = await load("USD");
  assert.equal(again.cached, true);
  assert.equal(urls.length, 1);
  await load("EUR");
  await load("CNY");
  assert.match(urls[1], /VAL_NM_RQ=R01239$/);
  assert.match(urls[2], /VAL_NM_RQ=R01375$/);
  t += 61 * 60 * 1000;
  assert.equal((await load("USD")).cached, false);
  assert.equal(urls.length, 4);
});

test("курсы: ЦБ не ответил, ответил ошибкой или прислал пустой ряд — понятный отказ, в память не попадает", async () => {
  const slow = createCbrLoader({ fetcher: (async () => { throw new Error("timeout"); }) as unknown as typeof fetch, now: () => NOW });
  await assert.rejects(slow("USD"), (e: unknown) => e instanceof CbrError && e.status === 504);
  const bad = createCbrLoader({ fetcher: (async () => new Response("x", { status: 503 })) as unknown as typeof fetch, now: () => NOW });
  await assert.rejects(bad("USD"), (e: unknown) => e instanceof CbrError && e.status === 502);
  let n = 0;
  const { fetcher } = fakeFetch(() => (++n === 1 ? ok("<ValCurs></ValCurs>") : ok(xml(ROWS))));
  const empty = createCbrLoader({ fetcher, now: () => NOW });
  await assert.rejects(empty("USD"), (e: unknown) => e instanceof CbrError && /пустой ряд/.test(e.message));
  assert.equal((await empty("USD")).points.length, 2, "пустой ответ в память не попал");
});

const denyAll: CbrDeps["authorize"] = async () => new Response("no", { status: 401 });
const allow: CbrDeps["authorize"] = async () => null;
const post = (body: unknown) => new Request("http://localhost/api/cbr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("маршрут курсов: без входа отказ; валюта не из списка — 400 и запрос к ЦБ не уходит; успех — ряд пар «дата — курс»", async () => {
  let loads = 0;
  const load: CbrDeps["load"] = async (code) => {
    loads++;
    return { code, name: "Доллар США", points: [{ date: "2026-10-22", rate: 81.9739 }], at: "2026-10-22T09:00:00.000Z", cached: false };
  };
  assert.equal((await handleCbr(post({ code: "USD" }), { authorize: denyAll, load })).status, 401);
  assert.equal(loads, 0);
  const wrong = await handleCbr(post({ code: "R01235&x=1" }), { authorize: allow, load });
  assert.equal(wrong.status, 400);
  assert.equal(loads, 0);
  const good = await handleCbr(post({ code: "USD" }), { authorize: allow, load });
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { code: "USD", name: "Доллар США", series: [["2026-10-22", 81.9739]], at: "2026-10-22T09:00:00.000Z", cached: false });
});

test("маршрут курсов: ошибка ЦБ отдаётся с её статусом и текстом, чужая ошибка — общим текстом без подробностей", async () => {
  const cbrFail: CbrDeps["load"] = async () => {
    throw new CbrError("Банк России не ответил вовремя. Повторите позже.", 504);
  };
  const r1 = await handleCbr(post({ code: "EUR" }), { authorize: allow, load: cbrFail });
  assert.equal(r1.status, 504);
  assert.match(await r1.text(), /не ответил вовремя/);
  const other: CbrDeps["load"] = async () => {
    throw new Error("secret internal detail");
  };
  const r2 = await handleCbr(post({ code: "EUR" }), { authorize: allow, load: other });
  assert.equal(r2.status, 502);
  assert.equal((await r2.text()).includes("secret"), false);
});
