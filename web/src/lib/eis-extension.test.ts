// Расширение Chrome для поиска в ЕИС: связь со страницей, чистые функции расширения, манифест, сборка extract.js — npm test (без Chrome и сети).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EIS_COPY_HEADERS } from "./eis-copy-script.ts";
import { EXTENSION_ATTR, extensionVersion, searchViaExtension, type BridgeWindow } from "./eis-extension.ts";
import { importTenders } from "./tender-import.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../extension/eis-bridge");
const require = createRequire(import.meta.url);
const helpers = require(path.join(ROOT, "helpers.js")) as {
  isAllowedUrl: (u: unknown) => boolean;
  pageUrl: (u: string, n: number) => string;
  clampPages: (n: unknown) => number;
  mergePages: (t: unknown[]) => string | null;
  pageIsFull: (t: unknown) => boolean;
  rowsOf: (t: string) => string[];
};

const HEADER = EIS_COPY_HEADERS.join("\t");
const row = (id: string, title = "Поставка шапок") => [id, "44-ФЗ", "Электронный аукцион", title, "Заказчик", "1000,00", "27.10.2026", "06.11.2026", `https://zakupki.gov.ru/x?regNumber=${id}`].join("\t");
const table = (...ids: string[]) => [HEADER, ...ids.map((i) => row(i))].join("\n");

// ——— Связь страницы с расширением ———

type Message = { type: string; requestId: string; url: string; pages: number };

function fakeWindow(reply?: (message: Message, send: (data: unknown) => void) => void) {
  const ls = new Set<(e: MessageEvent) => void>();
  const state = { listeners: 0 };
  const w = {
    location: { origin: "http://localhost:3000" },
    postMessage(message: unknown, targetOrigin: string) {
      assert.equal(targetOrigin, "http://localhost:3000", "сообщение уходит только своей странице");
      const m = message as Message;
      if (m.type === "TL_EIS_SEARCH" && reply) reply(m, (data) => setTimeout(() => ls.forEach((l) => l({ data } as unknown as MessageEvent)), 0));
    },
    addEventListener(_t: "message", l: (e: MessageEvent) => void) {
      ls.add(l);
      state.listeners = ls.size;
    },
    removeEventListener(_t: "message", l: (e: MessageEvent) => void) {
      ls.delete(l);
      state.listeners = ls.size;
    },
  };
  return { win: w as BridgeWindow, state };
}

test("страница видит расширение по атрибуту на <html>; без него — null", () => {
  const doc = (v: string | null) => ({ documentElement: { getAttribute: (n: string) => (n === EXTENSION_ATTR ? v : null) } });
  assert.equal(extensionVersion(doc("1.0.0")), "1.0.0");
  assert.equal(extensionVersion(doc(null)), null);
  assert.equal(extensionVersion(doc("  ")), null);
});

test("поиск через расширение: запрос уходит только своей странице, ответ с таблицей читается выгрузкой; слушатель снимается", async () => {
  const { win, state } = fakeWindow((m, send) => {
    assert.match(m.url, /^https:\/\/zakupki\.gov\.ru\/epz\/order\/extendedsearch\/results\.html\?/);
    assert.equal(m.pages, 3);
    send({ type: "TL_EIS_RESULT", requestId: m.requestId, tsv: table("111", "222"), pages: 1, count: 2 });
  });
  const r = await searchViaExtension("https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=x", 3, { win, newId: () => "id-1" });
  assert.equal(r.count, 2);
  assert.equal(importTenders(r.tsv).listings.length, 2);
  assert.equal(state.listeners, 0);
});

test("ответ на чужой запрос игнорируется; ошибка расширения и молчание — понятные сообщения", async () => {
  const a = fakeWindow((m, send) => {
    send({ type: "TL_EIS_RESULT", requestId: "чужой", tsv: table("999") });
    send({ type: "TL_EIS_RESULT", requestId: m.requestId, error: "ЕИС не открылся за 30 секунд." });
  });
  await assert.rejects(searchViaExtension("u", 1, { win: a.win }), /ЕИС не открылся за 30 секунд/);
  assert.equal(a.state.listeners, 0);
  const silent = fakeWindow();
  await assert.rejects(searchViaExtension("u", 1, { win: silent.win, timeoutMs: 20 }), /Расширение не ответило/);
  assert.equal(silent.state.listeners, 0);
});

// ——— Чистые функции расширения ———

test("расширение открывает только поиск закупок на zakupki.gov.ru: чужие адреса, другой путь и подделки отклоняются", () => {
  const ok = "https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=%D1%83%D0%B3%D0%BE%D0%BB%D1%8C&fz44=on";
  assert.equal(helpers.isAllowedUrl(ok), true);
  const bad: unknown[] = [
    "http://zakupki.gov.ru/epz/order/extendedsearch/results.html?a=1",
    "https://zakupki.gov.ru.evil.com/epz/order/extendedsearch/results.html?a=1",
    "https://evil.com/?https://zakupki.gov.ru/epz/order/extendedsearch/results.html?a=1",
    "https://zakupki.gov.ru/epz/order/notice/ea20/view/common-info.html?regNumber=1",
    "https://zakupki.gov.ru@evil.com/epz/order/extendedsearch/results.html?a=1",
    "javascript:alert(1)",
    "",
    null,
    42,
  ];
  for (const b of bad) assert.equal(helpers.isAllowedUrl(b), false, String(b));
  assert.equal(helpers.isAllowedUrl(ok + "&x=" + "a".repeat(2100)), false, "слишком длинный адрес");
});

test("страницы: номер подставляется в ссылку, число страниц не больше трёх, склейка без повторов и без сообщений об ошибке", () => {
  assert.equal(helpers.pageUrl("https://z/r.html?a=1&pageNumber=1&b=2", 3), "https://z/r.html?a=1&pageNumber=3&b=2");
  assert.equal(helpers.pageUrl("https://z/r.html?a=1", 2), "https://z/r.html?a=1&pageNumber=2");
  assert.deepEqual([0, 1, 2, 3, 9, "x", undefined, 2.7].map(helpers.clampPages), [1, 1, 2, 3, 3, 1, 1, 2]);
  const merged = helpers.mergePages([table("1", "2"), "!ЕИС просит подтвердить, что вы человек", table("2", "3"), "#мусор"]);
  assert.ok(merged);
  assert.equal(helpers.rowsOf(merged).map((l) => l.split("\t")[0]).join(","), "1,2,3");
  assert.equal(merged.split("\n")[0], HEADER);
  assert.equal(helpers.mergePages(["!ничего", "!ничего"]), null);
  const fifty = table(...Array.from({ length: 50 }, (_, i) => String(1000 + i)));
  assert.equal(helpers.pageIsFull(fifty), true, "полная страница — идём дальше");
  assert.equal(helpers.pageIsFull(table("1", "2")), false);
  assert.equal(helpers.pageIsFull("!ошибка"), false);
});

// ——— Состав расширения ———

test("манифест: только поиск ЕИС и адреса приложения, без лишних прав", () => {
  const m = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8")) as {
    manifest_version: number;
    permissions: string[];
    host_permissions: string[];
    content_scripts: { matches: string[]; js: string[] }[];
    background: { service_worker: string };
  };
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.host_permissions, ["https://zakupki.gov.ru/*"]);
  assert.deepEqual([...m.permissions].sort(), ["scripting", "tabs"]);
  assert.equal(m.content_scripts.length, 1);
  for (const match of m.content_scripts[0].matches) assert.match(match, /^http:\/\/(localhost|127\.0\.0\.1):3000\/\*$/, `мост на чужом адресе: ${match}`);
  assert.deepEqual(m.content_scripts[0].js, ["content.js"]);
  assert.equal(m.background.service_worker, "background.js");
});

test("extract.js собран из той же функции, что работает в закладке: не отстал от web/src/lib/eis-copy-script.ts", async () => {
  const { extractSource } = (await import(pathToFileURL(path.join(ROOT, "build.mjs")).href)) as { extractSource: () => string };
  const onDisk = readFileSync(path.join(ROOT, "extract.js"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(onDisk, extractSource(), "запустите npm --prefix web run extension:build");
});
