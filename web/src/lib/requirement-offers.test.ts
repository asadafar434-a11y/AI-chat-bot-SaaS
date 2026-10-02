// Требует заказчик — предлагает участник: статус требования считается из того, что участник вписал — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocator } from "./doc-locate.ts";
import { fieldsOf } from "./fields.ts";
import { fulfillmentOf } from "./fulfillment.ts";
import { EMPTY_PROFILE } from "./profile.ts";
import type { Purchase } from "./purchase.ts";
import { quoteChecker } from "./quotes.ts";
import { refineGroups } from "./requirement-engine.ts";
import { requirementViews, STATUS_TEXT } from "./requirement-offers.ts";
import type { DraftItem } from "./requirements.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM, type TpResult } from "./tp.ts";

const TZ = [
  "2.1. Исполнитель обеспечивает зал вместимостью не менее 150 мест в пределах города.",
  "2.2. Количество участников мероприятия: не менее 120 человек.",
  "2.3. Исполнитель обеспечивает гардероб для гостей.",
  "4.3. Передача фотографий в течение 5 рабочих дней после мероприятия.",
  "Закупка только у субъектов малого предпринимательства.",
  "Предложение участника закупки должно содержать описание порядка оказания услуг.",
].join("\n");
const docs = [{ name: "ТЗ.docx", text: TZ }];
const locator = createLocator(docs);
const found = quoteChecker([TZ]);

const draft = (text: string, quote: string, over: Partial<DraftItem> = {}): DraftItem => ({
  text, source: "ТЗ", quote, mandatory: "required", type: "service", deadline: "", numbers: [], check: "", evidence: [], ...over,
});

const requirements = refineGroups(
  {
    price: "",
    who: [draft("Только МСП", "Закупка только у субъектов малого предпринимательства", { type: "participant" })],
    submit: [draft("Предложение участника", "Предложение участника закупки должно содержать описание порядка оказания услуг.", { type: "document" })],
    scope: [
      draft("Зал от 150 мест", "Исполнитель обеспечивает зал вместимостью не менее 150 мест в пределах города."),
      draft("Не менее 120 участников", "Количество участников мероприятия: не менее 120 человек."),
      draft("Гардероб", "Исполнитель обеспечивает гардероб для гостей."),
      draft("Фото за 5 дней", "Передача фотографий в течение 5 рабочих дней после мероприятия."),
      draft("Сорок посадочных мест", "Тут цитата, которой нет в документах"),
    ],
    terms: [draft("Цена", "Начальная цена 100 000 руб.", { type: "money" })],
  },
  found
);

const tp = (offerHall: string, quote = "зал вместимостью не менее 150 мест"): TpResult => ({
  form: PLAIN_FORM,
  goods: [],
  items: [
    { clause: "2.1", topic: "Зал", requirement: "Зал от 150 мест", quote, offer: offerHall, verified: true },
    { clause: "2.3", topic: "Гардероб", requirement: "Гардероб", quote: "обеспечивает гардероб для гостей", offer: "Обеспечим гардероб.", verified: true },
  ],
  antiDumping: NO_ANTI_DUMPING,
});

function purchase(over: Partial<Purchase> = {}): Purchase {
  return {
    id: "p1", createdAt: "2026-10-01T10:00:00.000Z", short: "Праздник", subject: "", kind: "44-ФЗ · электронный аукцион", customer: "", price: "100 000",
    deadline: { date: "", time: "", zone: "" }, files: ["ТЗ.docx"], unreadable: [], requirements, ...over,
  };
}

const views = (p: Purchase) => {
  const fields = fieldsOf({ purchase: p, profile: EMPTY_PROFILE });
  const plans = fulfillmentOf(p, { fields });
  return requirementViews(p, { locate: (q) => locator.locate(q), fields, plans });
};
const byText = (list: ReturnType<typeof views>, text: string) => list.find((v) => v.text === text)!;

test("пока ТП нет: значение, которое выбирает участник, — «нужны ваши данные»; условие заказчика и простой пункт ТЗ — без статуса-действия", () => {
  const list = views(purchase());
  assert.equal(byText(list, "Зал от 150 мест").status, "open");
  assert.equal(byText(list, "Не менее 120 участников").status, "open");
  assert.equal(byText(list, "Гардероб").status, "info", "числа нет, ТП ещё нет");
  assert.equal(byText(list, "Фото за 5 дней").status, "info", "срок заказчика участник не выбирает");
  assert.equal(byText(list, "Только МСП").status, "info");
  assert.equal(byText(list, "Цена").status, "unverified", "цитаты «Начальная цена 100 000 руб.» нет в ТЗ");
  assert.equal(byText(list, "Сорок посадочных мест").status, "unverified");
});

test("предложение участника находится по месту цитаты: пустое место — «нужны ваши данные», вписанное подходящее — «подходит», неподходящее — «не подходит»", () => {
  const draftTp = tp("Обеспечим зал на [число, не меньше 150] мест.");
  const open = views(purchase({ tp: draftTp, tpDraft: draftTp }));
  const hall = byText(open, "Зал от 150 мест");
  assert.equal(hall.status, "open");
  assert.deepEqual([hall.offer?.rows.map((r) => r.topic), hall.offer?.open, hall.offer?.filled], [["Зал"], 1, 0]);

  const fine = views(purchase({ tp: tp("Обеспечим зал на 180 мест."), tpDraft: draftTp }));
  assert.equal(byText(fine, "Зал от 150 мест").status, "met");
  assert.equal(byText(fine, "Зал от 150 мест").offer?.filled, 1);

  const low = views(purchase({ tp: tp("Обеспечим зал на 120 мест."), tpDraft: draftTp }));
  assert.equal(byText(low, "Зал от 150 мест").status, "violated");
  assert.deepEqual(byText(low, "Зал от 150 мест").offer?.problems, ["120 — по ТЗ не меньше 150"]);
});

test("ответ ИИ словами без чисел участника — «проверьте», а не «подходит»: ИИ ответ не утверждает", () => {
  const list = views(purchase({ tp: tp("Обеспечим зал на [число, не меньше 150] мест.") }));
  assert.equal(byText(list, "Гардероб").status, "check");
  assert.deepEqual(byText(list, "Гардероб").offer?.rows.map((r) => r.topic), ["Гардероб"]);
});

test("пункт ТЗ без строки в ТП: с выбором участника — «нужны ваши данные», без — «проверьте»", () => {
  const list = views(purchase({ tp: tp("Обеспечим зал на 180 мест.") }));
  assert.equal(byText(list, "Не менее 120 участников").status, "open");
  assert.equal(byText(list, "Фото за 5 дней").status, "check");
  assert.equal(byText(list, "Не менее 120 участников").offer, undefined);
});

test("строка ТП с цитатой из другой части той же фразы всё равно находится: места цитат пересекаются", () => {
  const list = views(purchase({ tp: tp("Обеспечим зал на 180 мест.", "обеспечивает зал вместимостью не менее 150 мест в пределах города") }));
  assert.equal(byText(list, "Зал от 150 мест").offer?.rows.length, 1);
  // Цитата ТП, которой нет в документах, ни к чему не привязывается.
  const stray = views(purchase({ tp: tp("Обеспечим зал на 180 мест.", "такого в документах нет") }));
  assert.equal(byText(stray, "Зал от 150 мест").offer, undefined);
});

test("значение, которое ИИ подобрал в прежнем черновике, — «проверьте»: подтверждает участник", () => {
  const old = tp("Обеспечим зал на 150 мест.");
  const list = views(purchase({ tp: old, tpDraft: old }));
  assert.equal(byText(list, "Зал от 150 мест").status, "check");
  const confirmed = views(purchase({ tp: old, tpDraft: old, confirmed: ["confirm:guess:item:0"] }));
  assert.equal(byText(confirmed, "Зал от 150 мест").status, "check", "подтверждено, но своего значения участник не вписывал — «подходит» ставит только его число");
});

test("пункты «Что подать» — по плану выполнения; критерии оценки — отдельная группа «за баллы»", () => {
  const p = purchase({
    criteria: {
      howWins: "points",
      rows: [
        { criterion: "Цена", criterionWeight: "60 %", indicator: "", indicatorWeight: "", detail: "", detailWeight: "", scoring: "Чем ниже, тем больше", proof: "", form: "", source: "Порядок", quote: "Цена 60 %", verified: true },
        { criterion: "Опыт", criterionWeight: "40 %", indicator: "Договоры", indicatorWeight: "100 %", detail: "", detailWeight: "", scoring: "От 3 млн — 100 баллов", proof: "Договоры и акты", form: "", source: "Порядок", quote: "Договоры", verified: false },
      ],
    },
  });
  const list = views(p);
  const submit = list.find((v) => v.group === "submit")!;
  // ТП ещё нет, а «предложение по предмету закупки» составляет приложение: пункт ждёт действия.
  assert.deepEqual([submit.type, submit.status], ["document", "open"]);
  // ТП составлено, но в нём есть пустое место — пункт всё ещё ждёт вас; всё вписано — ждёт проверки: ИИ документ не утверждает.
  const holes = tp("Обеспечим зал на [число, не меньше 150] мест.");
  assert.equal(views({ ...p, tp: holes, tpDraft: holes }).find((v) => v.group === "submit")!.status, "open");
  const filled = views({ ...p, tp: tp("Обеспечим зал на 180 мест."), tpDraft: holes }).find((v) => v.group === "submit")!;
  assert.equal(filled.status, "check");
  const scoring = list.filter((v) => v.group === "criteria");
  assert.deepEqual(scoring.map((v) => [v.text, v.mandatory, v.type]), [["Цена (60 %)", "scored", "scoring"], ["Опыт — Договоры (40 %)", "scored", "scoring"]]);
  assert.deepEqual(scoring.map((v) => v.status), ["info", "unverified"]);
  assert.deepEqual(scoring[1].evidence, ["Договоры и акты"]);
  assert.equal(STATUS_TEXT.violated, "Не подходит");
});
