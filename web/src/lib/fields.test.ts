// Карта полей заявки: что заполнено само, что подтвердить, что вписать, и итоговая проверка комплекта — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyField, completeness, fieldQueue, fieldsOf, fieldSummary, filledValues, type ApplicationField } from "./fields.ts";
import { EMPTY_PROFILE, type Profile } from "./profile.ts";
import type { Purchase } from "./purchase.ts";
import type { ReqItem } from "./requirements.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM, type TpResult } from "./tp.ts";

const req = (text: string): ReqItem => ({ text, source: "Извещение, п. 8", quote: text, verified: true });

const tp = (offer: string, over: Partial<TpResult["form"]> = {}): TpResult => ({
  form: { ...PLAIN_FORM, ...over },
  goods: [],
  items: [{ clause: "2.1", topic: "Зал", requirement: "Зал не меньше 150 мест", quote: "не менее 150 мест", offer, verified: true }],
  antiDumping: NO_ANTI_DUMPING,
});

function purchase(over: Partial<Purchase> = {}): Purchase {
  return {
    id: "p1",
    createdAt: "2026-09-24T10:00:00.000Z",
    short: "Праздник: «День учителя»",
    subject: "",
    kind: "44-ФЗ · электронный аукцион",
    customer: "Школа № 1",
    price: "450 000",
    deadline: { date: "", time: "", zone: "" },
    files: [],
    unreadable: [],
    requirements: { who: [], submit: [req("Предложение участника")], scope: [], terms: [] },
    ...over,
  };
}

// Реквизиты Сбербанка из открытых источников — с правильными контрольными цифрами.
const PROFILE: Profile = {
  ...EMPTY_PROFILE,
  fullName: "ООО «Праздник»",
  inn: "7707083893",
  ogrn: "1027700132195",
  legalAddress: "г. Москва, ул. Вавилова, д. 19",
  head: "Генеральный директор Иванов И. И., действует на основании устава",
};

const byKey = (fields: ApplicationField[], key: string) => fields.find((f) => f.key === key);

test("значения на месте жёлтых полей находятся по заготовке; переписанный текст — неизвестно", () => {
  assert.deepEqual(filledValues("Зал на [число, не меньше 150] мест", "Зал на 180 мест"), ["180"]);
  assert.deepEqual(filledValues("Зал на [число] мест, [город]", "Зал на 180 мест, Москва"), ["180", "Москва"]);
  assert.deepEqual(filledValues("Зал на [число] мест", "Большой зал"), [null]);
  assert.deepEqual(filledValues("Без полей", "Без полей"), []);
});

test("реквизиты: есть — заполнено само из «Реквизитов», нет — вписать, с ошибкой — ошибка", () => {
  const p = purchase({ tp: tp("Предоставим зал") });
  const filled = fieldsOf({ purchase: p, profile: PROFILE });
  assert.deepEqual(
    [byKey(filled, "profile:inn")?.kind, byKey(filled, "profile:inn")?.status, byKey(filled, "profile:inn")?.source],
    ["auto", "filled", "Реквизиты"]
  );
  const empty = fieldsOf({ purchase: p, profile: EMPTY_PROFILE });
  assert.deepEqual([byKey(empty, "profile:inn")?.kind, byKey(empty, "profile:inn")?.status], ["manual", "needs_input"]);
  const typo = fieldsOf({ purchase: p, profile: { ...PROFILE, inn: "7707083894" } });
  assert.equal(byKey(typo, "profile:inn")?.status, "invalid");
  assert.match(byKey(typo, "profile:inn")?.problem ?? "", /контрольная цифра/i);
  // Реквизит, заполненный из документа участника, помнит этот документ.
  const fromDoc = fieldsOf({ purchase: p, profile: PROFILE, profileSources: { inn: "Карточка предприятия.pdf" } });
  assert.equal(byKey(fromDoc, "profile:inn")?.source, "Реквизиты — из «Карточка предприятия.pdf»");
});

test("жёлтое место в ТП — вписать; вписанное число сверяется с ТЗ", () => {
  const draft = tp("Зал на [число, не меньше 150] мест");
  const open = fieldsOf({ purchase: purchase({ tp: draft, tpDraft: draft }), profile: PROFILE });
  const hole = byKey(open, "tp:item:0:0");
  assert.deepEqual([hole?.kind, hole?.status, hole?.source], ["manual", "needs_input", "ТЗ, п. 2.1"]);

  const low = fieldsOf({ purchase: purchase({ tp: tp("Зал на 120 мест"), tpDraft: draft }), profile: PROFILE });
  assert.equal(byKey(low, "tp:item:0:done:0")?.status, "invalid");
  assert.equal(byKey(low, "tp:item:0:done:0")?.problem, "120 — по ТЗ не меньше 150");

  const ok = fieldsOf({ purchase: purchase({ tp: tp("Зал на 180 мест"), tpDraft: draft }), profile: PROFILE });
  assert.deepEqual([byKey(ok, "tp:item:0:done:0")?.status, byKey(ok, "tp:item:0:done:0")?.value], ["filled", "180"]);
});

test("подписант и цена — подтвердить; цена выше начальной — ошибка; подпись — только человек", () => {
  const p = purchase({ tp: tp("Предоставим зал", { hasPrice: true }), tpPrice: 500_000 });
  const fields = fieldsOf({ purchase: p, profile: PROFILE });
  assert.deepEqual([byKey(fields, "confirm:signer")?.kind, byKey(fields, "confirm:signer")?.status], ["confirm", "needs_confirmation"]);
  assert.equal(byKey(fields, "confirm:price")?.status, "invalid");
  assert.match(byKey(fields, "confirm:price")?.problem ?? "", /выше начальной/);
  assert.deepEqual([byKey(fields, "sign")?.kind, byKey(fields, "sign")?.status], ["sign", "action"]);

  const confirmed = fieldsOf({ purchase: { ...p, tpPrice: 440_000, confirmed: ["confirm:signer"] }, profile: PROFILE });
  assert.equal(byKey(confirmed, "confirm:signer")?.status, "filled");
  assert.equal(byKey(confirmed, "confirm:price")?.status, "filled");
});

test("непрочитанный файл — «нельзя определить», скан — сверить цифры", () => {
  const p = purchase({ tp: tp("Предоставим зал"), scans: ["ТЗ.jpg"], unreadable: [{ name: "Проект.pdf", reason: "файл защищён паролем" }] });
  const fields = fieldsOf({ purchase: p, profile: PROFILE });
  assert.deepEqual([byKey(fields, "file:Проект.pdf")?.kind, byKey(fields, "file:Проект.pdf")?.problem], ["unknown", "файл защищён паролем"]);
  assert.equal(byKey(fields, "confirm:scan:ТЗ.jpg")?.status, "needs_confirmation");
  const summary = fieldSummary(fields);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.sign, 1);
  assert.ok(summary.share > 0 && summary.share < 1);
});

test("мастер: сначала ошибки, потом непонятное, потом обязательное, в конце — подтверждения", () => {
  const draft = tp("Зал на [число, не меньше 150] мест, [адрес]");
  const p = purchase({
    tp: tp("Зал на 120 мест, [адрес]"),
    tpDraft: draft,
    unreadable: [{ name: "Проект.pdf", reason: "не прочитан" }],
  });
  const queue = fieldQueue(fieldsOf({ purchase: p, profile: PROFILE })).map((f) => f.key);
  assert.deepEqual(queue.slice(0, 3), ["tp:item:0:done:0", "file:Проект.pdf", "tp:item:0:0"]);
  assert.deepEqual(queue.slice(-2), ["confirm:signer", "confirm:price"]);
});

test("значение из мастера попадает на своё жёлтое место, в анкету или в подтверждения", () => {
  const p = purchase({ tp: tp("Зал на [число] мест, [адрес]") });
  assert.equal(applyField(p, "tp:item:0:1", "Москва")?.tp?.items[0].offer, "Зал на [число] мест, Москва");
  assert.deepEqual(applyField(p, "anketa:Контактное лицо по договору", "Петров П. П.")?.fieldValues, {
    "anketa:Контактное лицо по договору": "Петров П. П.",
  });
  assert.deepEqual(applyField({ ...p, confirmed: ["confirm:price"] }, "confirm:signer", "")?.confirmed, ["confirm:price", "confirm:signer"]);
  // Реквизиты правят в «Реквизитах» — общие для всех закупок.
  assert.equal(applyField(p, "profile:inn", "7707083893"), null);
});

test("итоговая проверка: пока есть пустые и неподтверждённые — «ещё не готова», потом — «сформирован»", () => {
  const draft = tp("Зал на [число, не меньше 150] мест");
  const open = purchase({ tp: draft, tpDraft: draft });
  const notReady = completeness(open, fieldsOf({ purchase: open, profile: PROFILE }));
  assert.equal(notReady.ready, false);
  assert.equal(
    notReady.text,
    "Заявка ещё не готова к подаче: не заполнено обязательных полей: 1, не подтверждено: 1, не готово документов заказчика: 1 из 1."
  );

  const done = purchase({ tp: tp("Зал на 180 мест"), tpDraft: draft, confirmed: ["confirm:signer"], submitReady: ["Предложение участника"] });
  const ready = completeness(done, fieldsOf({ purchase: done, profile: PROFILE }));
  assert.equal(ready.ready, true);
  assert.equal(ready.text, "Формальный комплект заявки сформирован. Осталось подписать его электронной подписью и подать на площадке.");
  assert.deepEqual(ready.signatures, { required: 1, done: 0 });
});
