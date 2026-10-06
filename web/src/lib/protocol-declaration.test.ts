// Отказ из протокола: заявка без декларации о принадлежности к МСП — проверка должна это заметить — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldsOf } from "./fields.ts";
import { fulfillmentOf } from "./fulfillment.ts";
import { EMPTY_PROFILE, type Profile } from "./profile.ts";
import type { Purchase } from "./purchase.ts";
import type { ReqItem } from "./requirements.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM, type TpResult } from "./tp.ts";

const SME_DECLARATION = "Декларация о принадлежности к субъектам малого и среднего предпринимательства";
const req = (text: string): ReqItem => ({ text, source: "Извещение", quote: text, verified: true });
const PROFILE: Profile = {
  ...EMPTY_PROFILE,
  fullName: "ООО «Праздник»",
  inn: "6612345676",
  smeCategory: "микропредприятие",
  head: "Директор Иванов И. И.",
  signer: "Иванов И. И.",
};

// Закупка 223-ФЗ: заказчик просит декларацию о малом бизнесе, заявка составлена.
function purchase(over: Partial<Purchase> = {}): Purchase {
  const tp: TpResult = {
    form: {
      ...PLAIN_FORM,
      title: "Заявка на участие в запросе котировок",
      source: "Извещение, приложение № 1",
      smeDeclaration: "[наименование участника] относится к субъектам МСП: [категория].",
    },
    goods: [],
    items: [{ clause: "1", topic: "Зал", requirement: "Зал на 180 мест", quote: "Зал на 180 мест", offer: "Предоставим зал на 180 мест", verified: true }],
    antiDumping: NO_ANTI_DUMPING,
  };
  return {
    id: "p1",
    createdAt: "2026-09-24T10:00:00.000Z",
    short: "День города",
    subject: "",
    kind: "223-ФЗ · запрос котировок в электронной форме",
    customer: "Парк",
    price: "450 000",
    deadline: { date: "", time: "", zone: "" },
    files: [],
    unreadable: [],
    requirements: { who: [], submit: [req(SME_DECLARATION)], scope: [], terms: [] },
    tp,
    ...over,
  };
}

const declarationStatus = (p: Purchase) => fulfillmentOf(p, { profile: PROFILE, fields: fieldsOf({ purchase: p, profile: PROFILE }) }).find((x) => x.rule === "sme")?.status;

test("декларация не отмечена как приложенная — пункт блокирует подачу", () => {
  assert.equal(declarationStatus(purchase()), "todo");
});

test("декларация отмечена как приложенная — пункт «готово»", () => {
  assert.equal(declarationStatus(purchase({ submitReady: [SME_DECLARATION] })), "done");
});

test("непрошенная декларация блокирует подачу, как отказ в протоколе", () => {
  assert.equal(declarationStatus(purchase()), "todo");
});
