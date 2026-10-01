// Главная цепочка заявки: требование → исключение → документ → ИИ → правка участника → повторный разбор → проверка → подача — npm test.
// ИИ здесь нет: его ответы — готовые данные, так же как приходят из /api/requirements и /api/tp; всё остальное — настоящий код.
import assert from "node:assert/strict";
import { test } from "node:test";
import { carryReady, fileRows, submitItems, toggleReady } from "./application-files.ts";
import { docsKeyOf, docsKeyOfDocuments, sameDocuments } from "./check.ts";
import { nextHref, progressOf, statusOf } from "./dashboard.ts";
import { stampsOf, tpChanges } from "./doc-changes.ts";
import { applyField, completeness, fieldQueue, fieldsOf } from "./fields.ts";
import { fulfillmentOf, holdsSubmission, requiredItems } from "./fulfillment.ts";
import { EMPTY_PROFILE, type Profile } from "./profile.ts";
import { fromRequirements, type Purchase } from "./purchase.ts";
import type { ReqItem, RequirementsResponse } from "./requirements.ts";
import { stepsOf } from "./steps.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM, type TpResult } from "./tp.ts";

const item = (text: string, quote = `В документах закупки сказано: ${text}`): ReqItem => ({ text, source: "Извещение, раздел 5", quote, verified: true });

// Пункты «Что подать» — словами заказчика; как их выполнять, решают правила по закону (lib/fulfillment.ts).
const CERT = item("Сертификат соответствия на поставляемый товар"); // приложить — обязательно
const PLATFORM = item("Декларацию о соответствии требованиям к участникам формирует площадка"); // передаст площадка
const CHARTER = item("Устав организации"); // у ИП устава нет
const IMAGE = item("Изображение товара (эскиз)"); // по 44-ФЗ без него не отклонят
const BIGDEAL = item("Решение об одобрении крупной сделки"); // только если сделка крупная
const POINTS = item("Документы для оценки по критериям: опыт работы"); // за баллы

const tpWith = (offer: string, over: Partial<TpResult["form"]> = {}): TpResult => ({
  form: { ...PLAIN_FORM, ...over },
  goods: [],
  items: [{ clause: "2.1", topic: "Зал", requirement: "Зал не меньше 150 мест", quote: "не менее 150 мест", offer, verified: true }],
  antiDumping: NO_ANTI_DUMPING,
});

const ORG: Profile = {
  ...EMPTY_PROFILE,
  fullName: "ООО «Праздник»",
  shortName: "ООО «Праздник»",
  inn: "7707083893",
  ogrn: "1027700132195",
  legalAddress: "г. Москва, ул. Вавилова, д. 19",
  head: "Генеральный директор Иванов Иван Иванович, действует на основании Устава",
  signer: "Иванов И. И.",
  smeCategory: "микропредприятие",
  vatNote: "НДС не облагается в связи с применением УСН",
};
// ИП — по двенадцати цифрам ИНН; значение приложению здесь важно только числом цифр.
const IP: Profile = { ...EMPTY_PROFILE, fullName: "Индивидуальный предприниматель Иванов Иван Иванович", inn: "500100732259", head: "ИП Иванов И. И.", signer: "Иванов И. И." };

function purchase(over: Partial<Purchase> = {}): Purchase {
  return {
    id: "p1",
    createdAt: "2026-10-01T10:00:00.000Z",
    short: "Праздник",
    subject: "",
    kind: "44-ФЗ · электронный аукцион",
    customer: "Школа № 1",
    price: "450 000",
    deadline: { date: "", time: "", zone: "" },
    files: ["ТЗ.docx"],
    unreadable: [],
    requirements: { who: [], submit: [], scope: [], terms: [] },
    ...over,
  };
}

// Закупка, в которой всё вписано и цена выбрана: не хватает только отметок у документов заказчика.
const filled = (submit: ReqItem[], over: Partial<Purchase> = {}) =>
  purchase({ requirements: { who: [], submit, scope: [], terms: [] }, tp: tpWith("Зал на 180 мест, гардероб."), tpPrice: 400_000, ...over });

const check = (p: Purchase, profile?: Profile) => completeness(p, fieldsOf({ purchase: p, profile: profile ?? EMPTY_PROFILE }), profile);

test("обязательное требование без документа блокирует подачу; отметили — подача открыта", () => {
  const p = filled([CERT]);
  const before = check(p, ORG);
  assert.equal(before.ready, false);
  assert.deepEqual(before.blocking, ["не готово документов заказчика: 1 из 1"]);
  const stepsBefore = stepsOf(p, ORG);
  assert.equal(stepsBefore[4].state, "fix");
  assert.equal(stepsBefore[4].status, "соберите 1 из 1");
  assert.equal(statusOf(p, stepsBefore), "progress");

  const marked = { ...p, submitReady: toggleReady(p, CERT.text) };
  const after = check(marked, ORG);
  assert.equal(after.ready, true);
  assert.deepEqual(after.blocking, []);
  const stepsAfter = stepsOf(marked, ORG);
  assert.equal(stepsAfter[4].state, "done");
  assert.equal(stepsAfter[4].status, "можно подавать");
  assert.equal(statusOf(marked, stepsAfter), "ready");
});

test("необязательное, условное, «передаст площадка» и «не требуется» подачу не блокируют", () => {
  const p = filled([CERT, PLATFORM, CHARTER, IMAGE, BIGDEAL, POINTS]);
  // ИП: устава нет, крупных сделок нет. Остаётся одно, что приложить: сертификат.
  assert.deepEqual(requiredItems(p, IP).map((i) => i.text), [CERT.text]);
  const withCert = { ...p, submitReady: toggleReady(p, CERT.text) };
  assert.equal(check(withCert, IP).ready, true, "отметили единственное нужное — подача открыта");
  assert.equal(stepsOf(withCert, IP)[4].status, "можно подавать");
  assert.equal(statusOf(withCert, stepsOf(withCert, IP)), "ready");

  // Организация: устав нужен (по 44-ФЗ заказчик не вправе его требовать, но надёжнее приложить), остальное — нет.
  assert.deepEqual(requiredItems(p, ORG).map((i) => i.text), [CERT.text, CHARTER.text]);
  assert.equal(check(withCert, ORG).ready, false);
  assert.equal(check({ ...p, submitReady: [CERT.text, CHARTER.text] }, ORG).ready, true);

  // Реквизитов нет — ИП это или организация, неизвестно: лишний раз приложить безопаснее, устав считаем нужным.
  assert.deepEqual(requiredItems(p).map((i) => i.text), [CERT.text, CHARTER.text]);
});

test("каждый пункт в списке «Что требует заказчик» знает, держит ли он подачу, и объясняет, если нет", () => {
  const p = filled([CERT, PLATFORM, CHARTER, IMAGE, BIGDEAL, POINTS]);
  const items = submitItems(p, IP);
  assert.deepEqual(
    items.map((i) => [i.text, i.required]),
    [[CERT.text, true], [PLATFORM.text, false], [CHARTER.text, false], [IMAGE.text, false], [BIGDEAL.text, false], [POINTS.text, false]]
  );
  for (const i of items.filter((x) => !x.required)) assert.ok(i.note && i.note.length > 10, `нет пояснения у «${i.text}»`);
  assert.match(items[1].note ?? "", /площадка/i);
  assert.match(items[2].note ?? "", /устава нет/i);
  assert.match(items[3].note ?? "", /не отклонят/i);
  assert.equal(items[0].note, undefined);
  // Отметка у ненужного пункта — по желанию участника: подаче не мешает и не нужна.
  assert.equal(check({ ...p, submitReady: [CERT.text, IMAGE.text] }, IP).ready, true);
});

test("список и план выполнения говорят одно: пункт держит подачу ровно тогда, когда план называет его обязательным", () => {
  const p = filled([CERT, PLATFORM, CHARTER, IMAGE, BIGDEAL, POINTS]);
  for (const profile of [IP, ORG]) {
    const plans = fulfillmentOf(p, { profile });
    const required = new Set(requiredItems(p, profile).map((i) => i.text));
    for (const plan of plans) assert.equal(required.has(plan.item.text), holdsSubmission(plan), `${plan.item.text}: ${plan.mode}`);
  }
});

test("ИИ заполнил заявку, участник изменил поле — повторный разбор документов его правки не стирает", () => {
  const draft = tpWith("Зал на [число, не меньше 150] мест, гардероб [тип гардероба].");
  let p = filled([CERT, PLATFORM], { tp: draft, tpDraft: draft, tpPrice: undefined });
  // Участник вписал оба места, подтвердил цену, отметил документ, ответил в чате и вписал строку анкеты.
  p = { ...p, ...applyField(p, "tp:item:0:0", "180")! };
  p = { ...p, ...applyField(p, "tp:item:0:0", "общий")! };
  p = { ...p, ...applyField(p, "confirm:price", "")!, tpPrice: 420_000, submitReady: toggleReady(p, CERT.text) };
  p = { ...p, fieldValues: { "anketa:Контактное лицо": "Петров П. П." }, chat: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Нужна ли декларация?" }] }] };
  assert.equal(p.tp?.items[0].offer, "Зал на 180 мест, гардероб общий.");

  // Добавили документы — ИИ выписал требования заново: сертификат переписал другими словами, цитата та же, пункт про площадку
  // исчез, добавился новый.
  const fresh: RequirementsResponse = {
    short: "Праздник — обновлено",
    subject: "Организация праздника",
    kind: "44-ФЗ · электронный аукцион",
    customer: "Школа № 1",
    price: "450 000",
    deadline: { date: "2026-11-01", time: "10:00", zone: "МСК" },
    groups: { who: [], submit: [item("Копия сертификата соответствия товара", CERT.quote), item("Свидетельство о регистрации товарного знака")], scope: [], terms: [] },
    criteria: { howWins: "unknown", rows: [] },
  };
  const result = fromRequirements(fresh);
  const merged: Purchase = {
    ...p,
    ...result,
    files: [...p.files, "Разъяснения.pdf"],
    unreadable: [],
    submitReady: carryReady(p.requirements.submit, p.submitReady ?? [], result.requirements.submit),
  };

  // Новое пришло из разбора…
  assert.equal(merged.short, "Праздник — обновлено");
  assert.deepEqual(merged.requirements.submit.map((i) => i.text), ["Копия сертификата соответствия товара", "Свидетельство о регистрации товарного знака"]);
  // …а всё, что вписал участник, на месте.
  assert.equal(merged.tp?.items[0].offer, "Зал на 180 мест, гардероб общий.");
  assert.deepEqual(merged.confirmed, ["confirm:price"]);
  assert.equal(merged.tpPrice, 420_000);
  assert.deepEqual(merged.fieldValues, { "anketa:Контактное лицо": "Петров П. П." });
  assert.equal(merged.chat?.length, 1);
  assert.deepEqual(merged.submitReady, ["Копия сертификата соответствия товара"], "отметка осталась у переписанного пункта и не прилипла к новому");
  const fields = fieldsOf({ purchase: merged, profile: ORG });
  assert.deepEqual(
    fields.filter((f) => f.key.startsWith("tp:item:0:done")).map((f) => [f.status, f.value]),
    [["filled", "180"], ["filled", "общий"]]
  );
});

test("отметки «готово» при повторном разборе: тот же текст, та же цитата — остаются; чужое и исчезнувшее — нет", () => {
  const long = "Участник обязан приложить копию действующего сертификата соответствия на весь поставляемый товар";
  const before = [item("Сертификат", long), item("Лицензия", "Копия лицензии на медицинскую деятельность, выданная лицензирующим органом"), item("Устав", "Устав")];
  const marked = ["Сертификат", "Лицензия"];
  // Цитата слово в слово, с другими пробелами, регистром и знаками; цитата внутри более длинной (не короче 40 знаков).
  const after = [
    item("Копия сертификата", `${long.toUpperCase()}.`),
    item("Лицензия медицинская", `Участник обязан приложить: копия лицензии на медицинскую деятельность, выданная лицензирующим органом, — в составе заявки`),
    item("Устав", "Устав"),
    item("Новый пункт", "Совсем другая цитата"),
  ];
  assert.deepEqual(carryReady(before, marked, after), ["Копия сертификата", "Лицензия медицинская"]);
  // Короткие цитаты внутри длинных не считаются той же цитатой: совпадёт случайно.
  assert.deepEqual(carryReady([item("А", "Устав")], ["А"], [item("Б", "Устав организации и все изменения к нему")]), []);
  // Пустые отметки и пустые цитаты ничего не переносят; повторов в ответе нет.
  assert.deepEqual(carryReady(before, [], after), []);
  assert.deepEqual(carryReady([item("А", "")], ["А"], [item("Б", "")]), []);
  assert.deepEqual(carryReady([item("А")], ["А"], [item("А"), item("А")]), ["А"]);
});

// Не реализовано: в «Профиле компании» нет дат окончания действия документов. Появятся — истёкший документ не должен
// считаться подтверждением, и этот тест станет настоящим.
test.todo("истёкший документ участника не считается подтверждением (сроков действия документов в приложении пока нет)");

test("изменение документации: проверка заявки узнаёт заменённый документ с тем же именем, добавленный и убранный", () => {
  const docs = [
    { name: "Извещение.pdf", text: "Срок подачи — 10 октября" },
    { name: "ТЗ.docx", text: "Зал не менее 150 мест" },
  ];
  const saved = docsKeyOfDocuments(docs);
  assert.equal(sameDocuments(saved, docs), true);
  assert.equal(sameDocuments(saved, [...docs].reverse()), true, "порядок файлов не важен: добавка того же файла его переставляет");
  // Заказчик выложил новую версию ТЗ под тем же именем — по одним именам это было не видно.
  assert.equal(sameDocuments(saved, [docs[0], { name: "ТЗ.docx", text: "Зал не менее 200 мест" }]), false);
  assert.equal(sameDocuments(saved, [...docs, { name: "Разъяснения.pdf", text: "…" }]), false);
  assert.equal(sameDocuments(saved, docs.slice(0, 1)), false);
  // Проверки, сохранённые раньше, помнят только имена: их сравниваем по именам — лишней тревоги нет.
  const legacy = docsKeyOf(docs.map((d) => d.name));
  assert.equal(sameDocuments(legacy, docs), true);
  assert.equal(sameDocuments(legacy, [...docs, { name: "Разъяснения.pdf", text: "…" }]), false);
});

const FILES = { missing: 0, evidence: { experience: 0, staff: 0 }, writing: null };
const REVIEW = "требует проверки";

test("изменение документации помечает составленные ТП и части заявки «требует проверки»; пока участник не подтвердит — не готово", () => {
  const docs = [
    { name: "Извещение.pdf", text: "Срок подачи — 10 октября" },
    { name: "ТЗ.docx", text: "Зал не менее 150 мест" },
  ];
  // Закупка готова к подаче: всё вписано, цена выбрана, документ заказчика отмечен; ТП составлено по этим документам.
  const base = filled([CERT], { submitReady: [CERT.text], docs: stampsOf(docs), tpDocs: stampsOf(docs) });
  assert.equal(tpChanges(base), null);
  assert.equal(statusOf(base, stepsOf(base, ORG)), "ready");
  assert.ok(!check(base, ORG).blocking.some((b) => /документы закупки изменились/.test(b)));

  // Заказчик выпустил изменения: добавили файл, а ТЗ выложили новой версией под тем же именем. Закупка сохранена с новыми документами.
  const newDocs = [docs[0], { name: "ТЗ.docx", text: "Зал не менее 200 мест" }, { name: "Изменения.pdf", text: "Площадка — не менее 200 мест" }];
  const changed = { ...base, docs: stampsOf(newDocs) };
  assert.deepEqual(tpChanges(changed), { added: ["Изменения.pdf"], removed: [], changed: ["ТЗ.docx"] });
  const steps = stepsOf(changed, ORG);
  assert.deepEqual([steps[3].state, steps[3].status, steps[3].tone], ["fix", "документы изменились", "warn"]);
  assert.equal(steps[4].state, "todo", "«Пакет» не говорит «можно подавать»");
  assert.equal(statusOf(changed, steps), "progress", "в списке — «В работе», а не «Готовы»");
  assert.ok(progressOf(steps) < 100);
  const gate = check(changed, ORG);
  assert.equal(gate.ready, false);
  assert.match(gate.text, /документы закупки изменились после составления ТП/);
  // Ручные правки ТП пометка не трогает: проверять нужно, а не терять.
  assert.equal(changed.tp?.items[0].offer, base.tp?.items[0].offer);

  // Участник проверил и подтвердил: снимок ТП стал равен снимку закупки — пометка снята, закупка снова готова.
  const confirmed = { ...changed, tpDocs: changed.docs };
  assert.equal(tpChanges(confirmed), null);
  assert.equal(statusOf(confirmed, stepsOf(confirmed, ORG)), "ready");
  assert.ok(!check(confirmed, ORG).blocking.some((b) => /документы закупки изменились/.test(b)));
  // И снова: изменили ещё раз после подтверждения — пометка возвращается.
  const again = { ...confirmed, docs: stampsOf([...newDocs, { name: "Разъяснения.pdf", text: "…" }]) };
  assert.deepEqual(tpChanges(again)?.added, ["Разъяснения.pdf"]);

  // Неизвестно, по каким документам составлено ТП (закупка старая), и ТП ещё нет — не тревожим.
  assert.equal(tpChanges({ ...changed, tpDocs: undefined }), null);
  assert.equal(tpChanges({ ...changed, docs: undefined }), null);
  assert.equal(tpChanges({ ...changed, tp: undefined }), null);
  assert.equal(stepsOf({ ...changed, tp: undefined }, ORG)[3].status, "не составлена");
});

test("пометка «требует проверки» стоит и у ТП, и у частей заявки, которые написаны по его форме", () => {
  const form = { ...PLAIN_FORM, hasPrice: true, participantFields: ["Контактное лицо по договору"], smeDeclaration: "[наименование участника] — [категория]." };
  const docs = [{ name: "ТЗ.docx", text: "Зал не менее 150 мест" }];
  const p = filled([CERT], {
    kind: "223-ФЗ · запрос котировок в электронной форме",
    tp: tpWith("Зал на 180 мест.", form),
    docs: stampsOf(docs),
    tpDocs: stampsOf(docs),
  });
  const fresh = fileRows(p, FILES);
  assert.ok(fresh.length > 1, "кроме ТП есть части заявки");
  assert.ok(fresh.every((r) => r.badge.text !== REVIEW));

  const stale = fileRows({ ...p, docs: stampsOf([{ name: "ТЗ.docx", text: "Зал не менее 200 мест" }]) }, FILES);
  assert.deepEqual(stale.map((r) => r.part), fresh.map((r) => r.part));
  assert.ok(stale.every((r) => r.badge.text === REVIEW && r.badge.tone === "warn"), stale.map((r) => r.badge.text).join(", "));
  // Что писать, как скачивать и какая подпись под строкой — прежнее: пометка только предупреждает, ничего не отнимает.
  assert.deepEqual(stale.map((r) => [r.part, r.title, r.action]), fresh.map((r) => [r.part, r.title, r.action]));
  // Часть, которую сейчас пишет ИИ, остаётся «пишу документ…»: это важнее.
  const writing = fileRows({ ...p, docs: stampsOf([{ name: "ТЗ.docx", text: "другое" }]) }, { ...FILES, writing: "declaration" });
  assert.equal(writing.find((r) => r.part === "declaration")?.badge.text, "пишу документ…");
});

test("статус закупки считается из самой закупки: черновик → в работе → готова → подана; «подана» снимается", () => {
  const draft = purchase({ requirements: { who: [], submit: [CERT], scope: [], terms: [] } });
  assert.equal(statusOf(draft, stepsOf(draft, ORG)), "draft");
  assert.equal(nextHref(stepsOf(draft, ORG)), "/p/p1/price", "первый шаг, где есть работа — цена");

  const priced = { ...draft, tpPrice: 400_000 };
  assert.equal(statusOf(priced, stepsOf(priced, ORG)), "progress");
  assert.equal(nextHref(stepsOf(priced, ORG)), "/p/p1/check");

  const holes = tpWith("Зал на [число, не меньше 150] мест");
  const composed = { ...priced, tp: holes, tpDraft: holes };
  assert.equal(statusOf(composed, stepsOf(composed, ORG)), "progress");
  assert.equal(stepsOf(composed, ORG)[3].state, "fix", "жёлтое место не вписано — проверка открыта");

  const done = { ...composed, ...applyField(composed, "tp:item:0:0", "180")!, submitReady: [CERT.text] };
  const steps = stepsOf(done, ORG);
  assert.ok(steps.every((s) => s.state === "done"));
  assert.equal(statusOf(done, steps), "ready");
  assert.equal(progressOf(steps), 100);
  assert.equal(nextHref(steps), "/p/p1/package", "всё сделано — на последний шаг");

  // Отметка «подана» — рукой участника; снял — вернулся прежний статус. Состояние закупки от неё не портится.
  assert.equal(statusOf({ ...done, submitted: true }), "submitted");
  assert.equal(progressOf(steps, true), 100);
  assert.equal(statusOf({ ...done, submitted: false }), "ready");
  // Заявка, которую ещё собирают, но участник уже подал на площадке, — «подана»: решает человек, а не расчёт.
  assert.equal(statusOf({ ...draft, submitted: true }), "submitted");
});

test("главный путь: разбор → цена → документы → вписать → подтвердить → отметить → «готова к подаче» → «подана»", () => {
  const form = { ...PLAIN_FORM, hasPrice: true, participantFields: ["Контактное лицо по договору"], smeDeclaration: "[наименование участника] — [категория]." };
  const draft = tpWith("Зал на [число, не меньше 150] мест, гардероб [тип].", form);
  const submit = [
    item("Предложение участника в отношении объекта закупки: программа мероприятия"),
    item("Декларация о принадлежности к субъектам МСП"),
    item("Предложение о цене договора"),
    item("Копии лицензий на оказание услуг"),
  ];
  // 1. Разбор документов: закупка 223-ФЗ создана, впереди вся работа.
  let p = purchase({ kind: "223-ФЗ · запрос котировок в электронной форме", requirements: { who: [], submit, scope: [], terms: [] } });
  assert.equal(statusOf(p, stepsOf(p, ORG)), "draft");
  // 2. Цена выбрана, документы составлены ИИ.
  p = { ...p, tpPrice: 400_000, tp: draft, tpDraft: draft };
  assert.equal(statusOf(p, stepsOf(p, ORG)), "progress");
  // 3. Реквизитов ещё нет — анкета, декларация и цена ждут их.
  const emptyProfile = completeness(p, fieldsOf({ purchase: p, profile: EMPTY_PROFILE }), EMPTY_PROFILE);
  assert.equal(emptyProfile.ready, false);
  assert.ok(emptyProfile.fields.empty >= 5, `пустых полей: ${emptyProfile.fields.empty}`);
  // 4. Мастер: по очереди вписываем то, что ждёт ответа человека, и подтверждаем то, что нужно подтвердить. Реквизиты общие
  // для всех закупок — их правят в «Реквизитах», мастер к ним не ведёт.
  const queueOf = (x: Purchase) => fieldQueue(fieldsOf({ purchase: x, profile: ORG })).filter((f) => !f.key.startsWith("profile:"));
  for (let guard = 0; guard < 30; guard++) {
    const queue = queueOf(p);
    if (!queue.length) break;
    const next = queue[0];
    const value = next.key.startsWith("anketa:") ? "Петров П. П." : next.key.endsWith(":0") ? "180" : "общий";
    const patch = applyField(p, next.key, value);
    assert.ok(patch, `мастер не смог записать поле ${next.key} (${next.status})`);
    p = { ...p, ...patch };
  }
  assert.deepEqual(queueOf(p), [], "мастер довёл очередь до конца");
  // В общей очереди остались только необязательные реквизиты (КПП, адрес почты…): без них заявку подают.
  const left = fieldQueue(fieldsOf({ purchase: p, profile: ORG }));
  assert.ok(left.every((f) => f.key.startsWith("profile:") && !f.required), left.map((f) => f.key).join(", "));
  // 5. Полей не осталось, но документы заказчика не отмечены — подача закрыта.
  const open = check(p, ORG);
  assert.equal(open.ready, false);
  assert.equal(open.fields.empty, 0);
  assert.equal(open.fields.invalid, 0);
  assert.match(open.blocking.join(" "), /не готово документов заказчика/);
  // 6. Отметили всё, что держит подачу.
  for (const needed of requiredItems(p, ORG)) p = { ...p, submitReady: toggleReady(p, needed.text) };
  const final = check(p, ORG);
  assert.equal(final.ready, true, final.text);
  assert.match(final.text, /Формальный комплект заявки сформирован/);
  const steps = stepsOf(p, ORG);
  assert.deepEqual(steps.map((s) => s.state), ["done", "done", "done", "done", "done"]);
  assert.equal(statusOf(p, steps), "ready");
  // 7. Участник подал заявку на площадке и отметил это.
  assert.equal(statusOf({ ...p, submitted: true }), "submitted");
});
