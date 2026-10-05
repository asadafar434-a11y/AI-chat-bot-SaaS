// План выполнения требований: как выполнить каждый пункт «Что подать» по 44-ФЗ и 223-ФЗ — npm test.
// Формулировки пунктов — из открытых извещений: таблица ЕИС «Требования к содержанию, составу заявки» (44-ФЗ)
// и информационная карта запроса котировок только для МСП (223-ФЗ).
import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldsOf } from "./fields.ts";
import { contextOf, fulfillmentOf, planSummary, ruleOf, type PlanContext } from "./fulfillment.ts";
import { EMPTY_PROFILE, type Profile } from "./profile.ts";
import type { Purchase } from "./purchase.ts";
import type { ReqItem } from "./requirements.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM, type TpResult } from "./tp.ts";
import { partsOf } from "./tp-parts.ts";

const req = (text: string): ReqItem => ({ text, source: "Извещение", quote: text, verified: true });

const CTX44: PlanContext = { law: "44", electronic: true, sme: false, participant: "ul", headSigns: true, points: false, parts: ["tp"] };
const SME223: PlanContext = { law: "223", electronic: true, sme: true, participant: "ul", headSigns: true, points: false, parts: ["tp", "participant"] };

const probe = (text: string, ctx: PlanContext) => {
  const found = ruleOf({ text, quote: text }, ctx);
  return { rule: found.rule, ...found.plan };
};

test("44-ФЗ, таблица ЕИС: СОНКО — площадка, декларация и счёт — подтвердить, крупная сделка — по условию", () => {
  const sonko = probe(
    "Декларация о принадлежности участника закупки к социально ориентированным некоммерческим организациям (при необходимости данная декларация предоставляется заказчику оператором электронной площадки путем информационного взаимодействия с единой информационной системой)",
    CTX44
  );
  assert.deepEqual([sonko.mode, sonko.mandatory], ["platform", false]);

  const deal = "Решение о согласии на совершение или о последующем одобрении крупной сделки, если требование о наличии такого решения установлено законодательством";
  assert.deepEqual([probe(deal, CTX44).mode, probe(deal, CTX44).mandatory, probe(deal, CTX44).basis], ["confirm", false, "пп. «м» п. 1 ч. 1 ст. 43 44-ФЗ"]);
  assert.equal(probe(deal, { ...CTX44, participant: "ip" }).mode, "not_required");

  const declaration = probe("Декларация о соответствии участника закупки требованиям, установленным пунктами 3 - 5, 7 - 11 части 1 статьи 31", CTX44);
  assert.deepEqual([declaration.rule, declaration.mode, declaration.basis], ["declaration", "confirm", "пп. «о» п. 1 ч. 1 ст. 43 44-ФЗ"]);

  // Анкеты по 44-ФЗ нет — реквизиты счёта указывают в заявке сами.
  const bank = probe("Реквизиты счета участника закупки, на который осуществляется перечисление денежных средств в качестве оплаты", CTX44);
  assert.deepEqual([bank.mode, bank.basis], ["confirm", "пп. «п» п. 1 ч. 1 ст. 43 44-ФЗ"]);

  const price = probe("Предложение участника закупки о цене контракта", CTX44);
  assert.equal(price.mode, "confirm");
  assert.match(price.todo, /Выше начальной или ноль — площадка вернёт заявку/);
});

test("44-ФЗ: сведения об участнике и выписку передаёт площадка, устав и доверенность — лишние требования", () => {
  for (const text of ["Анкета участника с реквизитами", "Выписка из ЕГРЮЛ", "ИНН, КПП, адрес участника"]) {
    const found = probe(text, CTX44);
    assert.equal(found.mode, "platform", text);
    assert.match(found.basis, /п\. 2 ч\. 6 ст\. 43 44-ФЗ/, text);
  }
  for (const text of ["Копия устава", "Доверенность на лицо, подписавшее заявку"]) {
    const found = probe(text, CTX44);
    assert.deepEqual([found.mode, found.extra, found.basis], ["upload", true, "ч. 3 ст. 43 44-ФЗ"], text);
  }
  // На бумаге (закрытый конкурс не в электронной форме) сведения об участнике подают сами — анкету составит приложение.
  const paper = probe("Анкета участника", { ...CTX44, electronic: false, parts: ["tp", "participant"] });
  assert.deepEqual([paper.mode, paper.basis], ["compose", "пп. «а»–«л» п. 1 ч. 1 ст. 43 44-ФЗ"]);
});

test("44-ФЗ: лицензия — приложить или сослаться на реестр, доп. требования — из реестра площадки, эскиз — по желанию", () => {
  const license = probe("Копия лицензии на осуществление деятельности", CTX44);
  assert.deepEqual([license.mode, license.basis], ["upload", "пп. «н», «о» п. 1 ч. 1 ст. 43 44-ФЗ"]);
  assert.match(license.todo, /открытом госреестре/);

  const extra = probe("Документы, подтверждающие соответствие дополнительным требованиям (постановление № 2571)", CTX44);
  assert.equal(extra.mode, "confirm");
  assert.match(extra.todo, /реестр/);

  const certificate = probe("Сертификат соответствия на товар", CTX44);
  assert.deepEqual([certificate.rule, certificate.mode, certificate.basis], ["conformity", "upload", "пп. «в» п. 2 ч. 1 ст. 43 44-ФЗ"]);

  const sketch = probe("Эскиз изделия", CTX44);
  assert.deepEqual([sketch.mode, sketch.mandatory, sketch.blocks], ["upload", false, false]);

  const security = probe("Обеспечение заявки — независимая гарантия или деньги на специальном счёте", CTX44);
  assert.deepEqual([security.mode, security.basis], ["confirm", "пп. «е», «ж» п. 5 ч. 6 ст. 43 44-ФЗ"]);
});

test("223-ФЗ, закупка только для МСП: закрытый перечень ч. 19.1 ст. 3.4 и условия «юрлицо или ИП»", () => {
  const who = probe(
    "Указание в заявке фирменного наименования, места нахождения (для юридического лица), фамилии, имени, отчества, паспортных данных (для физического лица), номера контактного телефона, адреса электронной почты участника",
    SME223
  );
  assert.deepEqual([who.mode, who.part, who.basis], ["compose", "participant", "п. 1–4 ч. 19.1 ст. 3.4 223-ФЗ"]);

  const charter = "Надлежащим образом заверенная копия действующей редакции учредительных документов участника (для юридических лиц)";
  assert.deepEqual([probe(charter, SME223).mode, probe(charter, SME223).basis], ["upload", "п. 1 ч. 19.1 ст. 3.4 223-ФЗ"]);
  assert.equal(probe(charter, { ...SME223, participant: "ip" }).mode, "not_required");

  // Полномочия: подписывает руководитель или сам ИП — не нужно (п. 5 ч. 19.1), представитель — нужна доверенность.
  const authority = "Документ, подтверждающий полномочия лица на осуществление действий от имени участника";
  assert.equal(probe(authority, SME223).mode, "not_required");
  assert.equal(probe(authority, { ...SME223, headSigns: false }).mode, "upload");

  // Выписку из ЕГРЮЛ в закупке для МСП требовать нельзя (ч. 19.3), выписку из сервиса оценки ФНС — тоже.
  assert.deepEqual([probe("Выписка из ЕГРЮЛ", SME223).mode, probe("Выписка из ЕГРЮЛ", SME223).extra], ["upload", true]);
  assert.equal(probe("Выписка из сервиса оценки юридических лиц по форме ФНС", SME223).mode, "not_required");
  assert.equal(probe("Выписка из сервиса оценки юридических лиц по форме ФНС", { ...SME223, sme: false }).mode, "upload");

  // Согласие даётся средствами площадки.
  assert.equal(probe("Согласие участника на оказание услуг (такое согласие дается с применением программно-аппаратных средств ЭП)", SME223).mode, "platform");

  // «Иным обязательным требованиям к лицам» — лицензия нужна, только если её требует закон.
  const other = probe("Документы, подтверждающие соответствие участника иным обязательным требованиям к лицам, осуществляющим оказание услуг", SME223);
  assert.deepEqual([other.rule, other.mode, other.mandatory], ["license", "confirm", false]);
});

test("223-ФЗ: без документов для оценки не отклоняют — их заказчик так и пишет", () => {
  const offer = probe("Предложение участника об оказании услуг. Непредставление документов не является причиной отклонения заявки", {
    ...SME223,
    points: true,
  });
  assert.deepEqual([offer.rule, offer.mode, offer.mandatory, offer.blocks], ["proposal", "compose", false, false]);

  const experience = probe("Справка об опыте оказания услуг — для оценки по критерию «Опыт оказания услуг»", {
    ...SME223,
    points: true,
    parts: ["tp", "participant", "experience"],
  });
  assert.deepEqual([experience.mode, experience.part, experience.mandatory, experience.basis], ["compose", "experience", false, "ч. 19.2 ст. 3.4 223-ФЗ"]);

  // Консорциум — только если заявку подают вместе с другими.
  assert.equal(probe("Документы консорциума, если на стороне участника выступают несколько лиц", SME223).mode, "not_required");
});

test("не узнали пункт — просим приложить, как требует заказчик", () => {
  const found = ruleOf({ text: "Гарантийное письмо о наличии складских помещений", quote: "" }, CTX44);
  assert.deepEqual([found.rule, found.plan.mode, found.plan.mandatory, found.plan.blocks], [null, "upload", true, true]);
});

const tp = (offer: string): TpResult => ({
  form: { ...PLAIN_FORM },
  goods: [],
  items: [{ clause: "2.1", topic: "Зал", requirement: "Зал не меньше 150 мест", quote: "не менее 150 мест", offer, verified: true }],
  antiDumping: NO_ANTI_DUMPING,
});

function purchase(over: Partial<Purchase> = {}): Purchase {
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
    requirements: {
      who: [req("Участниками могут быть только субъекты малого и среднего предпринимательства")],
      submit: [req("Предложение участника в отношении объекта закупки"), req("Копия устава"), req("Выписка из сервиса оценки юридических лиц"), req("Копия лицензии")],
      scope: [],
      terms: [],
    },
    ...over,
  };
}

const PROFILE: Profile = { ...EMPTY_PROFILE, inn: "7707083893", head: "Генеральный директор Иванов И. И., действует на основании устава", signer: "Иванов И. И." };

test("контекст: закон, закупка для МСП, организация или ИП, кто подписывает", () => {
  const ctx = contextOf(purchase(), PROFILE);
  assert.deepEqual([ctx.law, ctx.sme, ctx.participant, ctx.headSigns], ["223", true, "ul", true]);
  assert.equal(contextOf(purchase({ requirements: { ...purchase().requirements, who: [] } }), PROFILE).sme, false);
  assert.equal(contextOf(purchase({ kind: "223-ФЗ · запрос котировок среди субъектов МСП", requirements: { ...purchase().requirements, who: [] } })).sme, true);
  assert.equal(contextOf(purchase(), { ...PROFILE, inn: "500100732259" }).participant, "ip");
  assert.equal(contextOf(purchase(), { ...PROFILE, signer: "Петров П. П., по доверенности № 5" }).headSigns, false);
});

test("анкету по 44-ФЗ не составляем: сведения об участнике передаёт площадка", () => {
  assert.deepEqual(partsOf(PLAIN_FORM, undefined, "44-ФЗ · электронный аукцион"), ["tp"]);
  assert.deepEqual(partsOf(PLAIN_FORM, undefined, "44-ФЗ · открытый конкурс"), ["tp"]);
  assert.deepEqual(partsOf(PLAIN_FORM, undefined, "44-ФЗ · закрытый конкурс"), ["tp", "participant"]);
  // Запрос котировок: заказчик даёт единый бланк заявки (Приложение № 1) — он идёт отдельным файлом.
  assert.deepEqual(partsOf(PLAIN_FORM, undefined, "223-ФЗ · запрос котировок"), ["tp", "participant", "application"]);
  assert.deepEqual(partsOf(PLAIN_FORM), ["tp", "participant"]);
});

test("статусы: составленное — проверить, пока человек не отметил; приложить — сделать; не требуется — серое", () => {
  const draft = purchase();
  assert.deepEqual(
    fulfillmentOf(draft, { profile: PROFILE }).map((x) => [x.rule, x.status]),
    [
      ["proposal", "todo"],
      ["charter", "todo"],
      ["fns", "none"],
      ["license", "todo"],
    ]
  );

  // ТП составлено и заполнено, но не проверено человеком — «подтвердить»; отметил — «готово».
  const composed = purchase({ tp: tp("Предоставим зал на 180 мест") });
  const fields = fieldsOf({ purchase: composed, profile: PROFILE });
  assert.equal(fulfillmentOf(composed, { profile: PROFILE, fields })[0].status, "confirm");
  const checked = { ...composed, submitReady: ["Предложение участника в отношении объекта закупки", "Копия устава"] };
  const plans = fulfillmentOf(checked, { profile: PROFILE, fields: fieldsOf({ purchase: checked, profile: PROFILE }) });
  assert.deepEqual(
    plans.map((x) => x.status),
    ["done", "done", "none", "todo"]
  );
  assert.deepEqual(planSummary(plans), { done: 2, confirm: 0, todo: 1, none: 1, blocking: 1, extra: 0 });

  // Пустое жёлтое место в ТП — «сделать», даже если отмечено.
  const open = { ...checked, tp: tp("Зал на [число, не меньше 150] мест") };
  assert.equal(fulfillmentOf(open, { profile: PROFILE, fields: fieldsOf({ purchase: open, profile: PROFILE }) })[0].status, "todo");
});
