// Шаги заявки: Загрузка → Анализ → Цена → Проверка → Пакет, их состояние и подпись — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CheckResult } from "./check.ts";
import type { Purchase } from "./purchase.ts";
import type { ReqItem } from "./requirements.ts";
import { reviewGaps, stepsOf } from "./steps.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM, type TpResult } from "./tp.ts";

const req = (text: string): ReqItem => ({ text, source: "Извещение, п. 8", quote: text, verified: true });
const tp = (offer: string, over: Partial<TpResult["form"]> = {}): TpResult => ({
  form: { ...PLAIN_FORM, ...over },
  goods: [],
  items: [{ clause: "1", topic: "Площадка", requirement: "Площадь зала", quote: "площадь зала", offer, verified: true }],
  antiDumping: NO_ANTI_DUMPING,
});
const check = (...kinds: ("bad" | "warn")[]) =>
  ({ findings: kinds.map((kind) => ({ kind, text: "", source: "", quote: "" })), files: [], docsKey: "", checkedAt: "" }) as unknown as CheckResult;

function purchase(over: Partial<Purchase> = {}): Purchase {
  return {
    id: "p1",
    createdAt: "2026-09-24T10:00:00.000Z",
    short: "Праздник",
    subject: "",
    kind: "223-ФЗ · открытый конкурс",
    customer: "Школа № 1",
    price: "500 000,00 ₽",
    deadline: { date: "", time: "", zone: "" },
    files: ["Извещение.pdf", "ТЗ.docx"],
    unreadable: [],
    requirements: { who: [req("Только МСП")], submit: [req("Предложение участника"), req("Выписка из ЕГРЮЛ")], scope: [], terms: [] },
    ...over,
  };
}

const view = (p: Purchase) => stepsOf(p).map((s) => [s.key, s.state, s.status, s.tone]);

test("пять шагов по порядку, с адресами; ТП — страница «Пакета»", () => {
  const steps = stepsOf(purchase());
  assert.deepEqual(
    steps.map((s) => [s.n, s.title, s.href]),
    [
      [1, "Загрузка", "/p/p1/files"],
      [2, "Анализ", "/p/p1"],
      [3, "Цена", "/p/p1/price"],
      [4, "Проверка", "/p/p1/check"],
      [5, "Пакет", "/p/p1/package"],
    ]
  );
  assert.ok(steps[4].paths.includes("/p/p1/tp"));
});

test("новая закупка: документы разобраны, цена не выбрана, заявка не составлена", () => {
  assert.deepEqual(view(purchase()), [
    ["upload", "done", "2 документа", "calm"],
    ["analysis", "done", "выписаны: 3 пункта", "calm"],
    ["price", "todo", "не выбрана", "calm"],
    ["review", "todo", "не составлена", "calm"],
    ["package", "todo", "нет документов", "calm"],
  ]);
  const unread = view(purchase({ unreadable: [{ name: "Схема.doc", reason: "" }], requirements: { who: [], submit: [], scope: [], terms: [] } }));
  assert.deepEqual(unread[0], ["upload", "fix", "не прочитано: 1", "warn"]);
  assert.deepEqual(unread[1], ["analysis", "done", "не нашлись в документах", "warn"]);
});

test("цена: выбранная — зелёным, выше начальной — ошибка", () => {
  assert.deepEqual(view(purchase({ tpPrice: 450_000 }))[2], ["price", "done", "450 000 ₽", "ok"]);
  assert.deepEqual(view(purchase({ priceCalc: { price: 480_000.5 } }))[2], ["price", "done", "480 000,50 ₽", "ok"]);
  assert.deepEqual(view(purchase({ tpPrice: 600_000 }))[2], ["price", "fix", "выше начальной", "bad"]);
});

test("проверка: пустые места, ошибка в числе, своя заявка с ошибками, всё заполнено", () => {
  assert.deepEqual(view(purchase({ tp: tp("Зал на [число] мест, [адрес]") }))[3], ["review", "fix", "впишите 2 поля", "warn"]);
  const low = purchase({ tp: tp("Площадь зала 120 м²"), tpDraft: tp("Площадь зала [число, не меньше 150] м²") });
  assert.deepEqual(reviewGaps(low), { empty: 0, invalid: 1, price: false });
  assert.deepEqual(view(low)[3], ["review", "fix", "исправьте 1 поле", "bad"]);
  assert.deepEqual(view(purchase({ tp: tp("Зал на 300 мест"), check: check("bad", "warn") }))[3], ["review", "fix", "1 ошибка", "bad"]);
  assert.deepEqual(view(purchase({ tp: tp("Зал на 300 мест") }))[3], ["review", "done", "заполнена", "ok"]);
  // Форма с ценой: без выбранной цены заявка не заполнена; цену ставят на шаге «Цена».
  assert.deepEqual(view(purchase({ tp: tp("Зал на 300 мест", { hasPrice: true }) }))[3], ["review", "fix", "нужна цена", "warn"]);
  assert.deepEqual(view(purchase({ tp: tp("Зал на 300 мест", { hasPrice: true }), tpPrice: 450_000 }))[3], ["review", "done", "заполнена", "ok"]);
});

test("пакет: пока проверка не пройдена — число файлов; потом — что собрать из «Что подать»", () => {
  assert.deepEqual(view(purchase({ tp: tp("Зал на [число] мест") }))[4], ["package", "todo", "2 файла", "calm"]);
  // По 44-ФЗ анкеты нет — остаётся одно ТП.
  assert.deepEqual(view(purchase({ kind: "44-ФЗ · открытый конкурс", tp: tp("Зал на [число] мест") }))[4], ["package", "todo", "1 файл", "calm"]);
  assert.deepEqual(view(purchase({ tp: tp("Зал на 300 мест") }))[4], ["package", "fix", "соберите 2 из 2", "warn"]);
  const ready = purchase({ tp: tp("Зал на 300 мест"), submitReady: ["Предложение участника", "Выписка из ЕГРЮЛ"] });
  assert.deepEqual(view(ready)[4], ["package", "done", "можно подавать", "ok"]);
});
