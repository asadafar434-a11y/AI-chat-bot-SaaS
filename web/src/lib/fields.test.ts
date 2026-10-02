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
    kind: "223-ФЗ · запрос котировок в электронной форме",
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

test("по 44-ФЗ анкеты нет — реквизитов и подписанта в карте полей тоже; цена в заявке — со своими реквизитами", () => {
  const p = purchase({ kind: "44-ФЗ · электронный аукцион", tp: tp("Предоставим зал") });
  const fields = fieldsOf({ purchase: p, profile: PROFILE });
  assert.equal(fields.some((f) => f.key.startsWith("profile:") || f.key === "confirm:signer"), false);
  const withPrice = fieldsOf({ purchase: { ...p, tp: tp("Предоставим зал", { hasPrice: true }) }, profile: PROFILE });
  assert.deepEqual(
    withPrice.filter((f) => f.key.startsWith("profile:")).map((f) => f.key),
    ["profile:vatNote"]
  );
  assert.equal(byKey(withPrice, "confirm:signer")?.status, "needs_confirmation");
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

test("уже вписанное значение можно исправить: по ТЗ «не меньше 150» — вписали 120, исправили на 180", () => {
  const draft = tp("Зал на [число, не меньше 150] мест, [адрес]");
  const low = purchase({ tp: tp("Зал на 120 мест, Москва"), tpDraft: draft });
  assert.equal(byKey(fieldsOf({ purchase: low, profile: PROFILE }), "tp:item:0:done:0")?.status, "invalid");

  const fixed = { ...low, ...applyField(low, "tp:item:0:done:0", "180") };
  assert.equal(fixed.tp?.items[0].offer, "Зал на 180 мест, Москва", "остальное вписанное не пропало");
  assert.equal(byKey(fieldsOf({ purchase: fixed, profile: PROFILE }), "tp:item:0:done:0")?.status, "filled");

  const other = { ...fixed, ...applyField(fixed, "tp:item:0:done:1", "Казань") };
  assert.equal(other.tp?.items[0].offer, "Зал на 180 мест, Казань");

  // Без заготовки не знаем, что было на месте, — не трогаем.
  assert.equal(applyField({ ...low, tpDraft: undefined }, "tp:item:0:done:0", "180"), null);
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

test("подсказки с «не больше», диапазоном и размерами сверяются так же, как «не меньше»", () => {
  const draft = (offer: string) => tp(offer);
  const check = (draftText: string, filledText: string) =>
    byKey(fieldsOf({ purchase: purchase({ tp: tp(filledText), tpDraft: draft(draftText) }), profile: PROFILE }), "tp:item:0:done:0");

  assert.equal(check("Вес [число, не больше 5] кг", "Вес 6 кг")?.problem, "6 — по ТЗ не больше 5");
  assert.equal(check("Вес [число, не больше 5] кг", "Вес 4,5 кг")?.status, "filled");
  assert.equal(check("Опыт [число, от 3 до 5] лет", "Опыт 7 лет")?.problem, "7 — по ТЗ от 3 до 5");
  assert.equal(check("Опыт [число, от 3 до 5] лет", "Опыт 4 лет")?.status, "filled");
  assert.equal(check("Экран [размер, не меньше 3×2] м", "Экран 2×1,5 м")?.problem, "2×1,5 — по ТЗ не меньше 3×2");
  assert.equal(check("Экран [размер, не меньше 3×2] м", "Экран 4×2,5 м")?.status, "filled");
  // Подсказки нет — вписанное принимается как есть.
  assert.equal(check("Адрес [адрес зала]", "Адрес ул. Мира, 5")?.status, "filled");
});

test("значение, которое ИИ подобрал за участника в прежнем черновике, — «подтвердите», а не «заполнено само»", () => {
  // Черновик, составленный до запрета: ИИ поставил число на границу требования «не менее 150 мест».
  const old = tp("Зал на 150 мест, гардероб.");
  const p = purchase({ tp: old, tpDraft: old });
  const guess = byKey(fieldsOf({ purchase: p, profile: PROFILE }), "confirm:guess:item:0");
  assert.deepEqual([guess?.kind, guess?.status, guess?.required, guess?.value, guess?.context], ["confirm", "needs_confirmation", true, "150 мест", "Зал"]);
  assert.match(guess?.problem ?? "", /^По ТЗ не менее 150 мест\. ИИ взял её как ваше значение/);
  assert.equal(guess?.quote, "не менее 150 мест");

  // Блокирует готовность, пока участник не подтвердит; после подтверждения — «готово».
  const open = completeness(p, fieldsOf({ purchase: p, profile: PROFILE }));
  assert.match(open.text, /не подтверждено: \d/);
  const confirmed = { ...p, ...applyField(p, "confirm:guess:item:0", "") };
  assert.equal(byKey(fieldsOf({ purchase: confirmed, profile: PROFILE }), "confirm:guess:item:0")?.status, "filled");

  // Новый черновик с пустым местом вместо числа, а также число, которое участник вписал сам, этого поля не дают.
  const fresh = tp("Зал на [число, не меньше 150] мест, гардероб.");
  assert.equal(byKey(fieldsOf({ purchase: purchase({ tp: fresh, tpDraft: fresh }), profile: PROFILE }), "confirm:guess:item:0"), undefined);
  const typed = purchase({ tp: tp("Зал на 150 мест, гардероб."), tpDraft: fresh });
  assert.equal(byKey(fieldsOf({ purchase: typed, profile: PROFILE }), "confirm:guess:item:0"), undefined, "вписанное участником — его решение");
  assert.equal(byKey(fieldsOf({ purchase: typed, profile: PROFILE }), "tp:item:0:done:0")?.status, "filled");
  // Без черновика не узнать, что писал ИИ, а что участник, — ничего не придумываем.
  assert.equal(byKey(fieldsOf({ purchase: purchase({ tp: old }), profile: PROFILE }), "confirm:guess:item:0"), undefined);
});
