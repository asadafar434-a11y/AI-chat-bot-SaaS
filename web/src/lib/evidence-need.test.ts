// Требование → какое доказательство нужно — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, freshnessDaysOf, needsOf, needsOfPurchase, windowMonthsOf } from "./evidence-need.ts";
import { EMPTY_PROFILE } from "./profile.ts";
import type { Purchase } from "./purchase.ts";
import { requirementOf, refineGroups } from "./requirement-engine.ts";
import type { DraftItem, ReqItem } from "./requirements.ts";

const req = (text: string, group: "who" | "submit" | "scope" | "terms" = "who", over: Partial<ReqItem> = {}) =>
  requirementOf({ text, source: "Извещение", quote: text, verified: true, ...over }, group);

const kinds = (text: string) => classify(text).map((s) => s.kind);

test("что просит текст: лицензия, сертификат, документы компании, опыт, специалисты, оборудование, финансы", () => {
  assert.deepEqual(kinds("Наличие лицензии на образовательную деятельность"), ["license"]);
  assert.deepEqual(kinds("Участник должен быть членом СРО"), ["license"]);
  assert.deepEqual(kinds("Сертификат соответствия ГОСТ Р на поставляемый товар"), ["certificate"]);
  assert.deepEqual(kinds("Копия устава или иного учредительного документа"), ["document"]);
  assert.deepEqual(kinds("Выписка из ЕГРЮЛ, полученная не ранее чем за 30 дней"), ["document"]);
  assert.deepEqual(kinds("Наличие опыта оказания услуг, подтверждённого исполненными договорами"), ["experience"]);
  assert.deepEqual(kinds("Специалисты с высшим образованием и дипломом"), ["employee"]);
  assert.deepEqual(kinds("Наличие у участника оборудования в собственности или на ином праве"), ["equipment"]);
  assert.deepEqual(kinds("Выручка за последний год не менее 3 млн руб."), ["finance"]);
  assert.deepEqual(kinds("Бухгалтерская отчётность за прошлый год"), ["finance"]);
});

test("«опыт» у людей — сотрудник, у компании — договоры; обычные условия — ничего", () => {
  assert.deepEqual(kinds("Ведущий мероприятия — с опытом проведения официальных мероприятий не менее 3 лет"), ["employee"]);
  assert.deepEqual(kinds("Наличие опыта оказания услуги, связанного с предметом контракта"), ["experience"]);
  assert.deepEqual(kinds("Опыт работы по направлению не менее 2 лет, исполненные договоры"), ["experience"], "про договоры — опыт компании");
  assert.deepEqual(kinds("Подать заявку до 30 сентября, 10:00 МСК"), []);
  assert.deepEqual(kinds("Начальная цена — 685 000 ₽"), []);
  assert.deepEqual(kinds("Оплата — в течение 7 рабочих дней после подписания акта"), []);
  assert.deepEqual(kinds("Кофе-брейк на 120 человек: чай, кофе"), []);
});

test("свежесть документа: «не ранее чем за 30 дней», «не старше 6 месяцев», «за две недели»", () => {
  assert.equal(freshnessDaysOf("выписка из ЕГРЮЛ, полученная не ранее чем за 30 календарных дней до даты окончания срока подачи заявок"), 30);
  assert.equal(freshnessDaysOf("не ранее чем за пять (5) рабочих дней"), 5);
  assert.equal(freshnessDaysOf("справка не старше 6 месяцев"), 180);
  assert.equal(freshnessDaysOf("давность не более 2 недель"), 14);
  assert.equal(freshnessDaysOf("актуальная выписка"), undefined);
  assert.equal(freshnessDaysOf("Устав в действующей редакции"), undefined);
});

test("период опыта: «за последние 3 года», «в течение трёх лет», «за 18 месяцев»", () => {
  assert.equal(windowMonthsOf("исполненных контрактов за последние 3 года до даты подачи"), 36);
  assert.equal(windowMonthsOf("в течение трёх лет до даты подачи заявки"), 36);
  assert.equal(windowMonthsOf("за последние пять лет"), 60);
  assert.equal(windowMonthsOf("за 18 месяцев"), 18);
  assert.equal(windowMonthsOf("опыт оказания услуг"), undefined);
});

test("требование к участнику: лицензия — документ, искать по предмету лицензии, а не по слову «лицензия»", () => {
  const [need] = needsOf({ id: "who-0", requirement: req("Наличие лицензии на образовательную деятельность") });
  assert.deepEqual(
    [need.kind, need.proof, need.stems, need.optional, need.scoring, need.basis],
    ["license", "document", ["образ"], false, false, "Требование к участнику"]
  );
  assert.equal(need.id, "who-0#0");
});

test("требование ТЗ с числом: оборудование — слова компании, число заказчика — то, что факт должен подтвердить", () => {
  const needs = needsOf({ id: "scope-1", requirement: req("Зал вместимостью не менее 150 мест в пределах города", "scope") });
  assert.equal(needs.length, 1);
  assert.deepEqual([needs[0].kind, needs[0].proof], ["equipment", "statement"]);
  assert.deepEqual(needs[0].measures.map((c) => [c.op, c.value, c.unit]), [["min", 150, "мест"]]);

  const staff = needsOf({ id: "scope-2", requirement: req("Ведущий — с опытом проведения мероприятий не менее 3 лет", "scope") });
  assert.deepEqual([staff[0].kind, staff[0].measures.map((c) => [c.value, c.unit])], ["employee", [[3, "лет"]]]);
});

test("«по желанию», «за баллы» и «при условии» — нет доказательства не мешает подаче; критерии — всегда за баллы", () => {
  const optional = needsOf({ id: "who-1", requirement: req("Сертификат ISO 9001 — по желанию", "who", { mandatory: "optional" }) });
  assert.deepEqual([optional[0].kind, optional[0].optional], ["certificate", true]);
  assert.deepEqual(optional[0].stems, ["iso", "9001"]);
  const scored = needsOf({ id: "who-2", requirement: req("Наличие лицензии на образовательную деятельность", "who", { mandatory: "conditional" }) });
  assert.equal(scored[0].optional, true);
});

test("«чем подтвердить» из разбора — название потребности; общий текст остаётся запасным", () => {
  const needs = needsOf({
    id: "who-3",
    requirement: req("Участник должен иметь допуск к работам", "who", { evidence: ["копия свидетельства СРО о допуске к работам"] }),
  });
  assert.equal(needs[0].kind, "license");
  assert.equal(needs[0].label, "Копия свидетельства СРО о допуске к работам");
});

const draft = (text: string, over: Partial<DraftItem> = {}): DraftItem => ({
  text, source: "Извещение", quote: text, mandatory: "required", type: "document", deadline: "", numbers: [], check: "", evidence: [], ...over,
});

function purchase(kind: string, submit: DraftItem[], over: Partial<Purchase> = {}): Purchase {
  const groups = refineGroups({ price: "", who: [], submit, scope: [], terms: [] }, () => true);
  return {
    id: "p1", createdAt: "2026-10-01T10:00:00.000Z", short: "Закупка", subject: "", kind, customer: "", price: "100 000",
    deadline: { date: "2026-11-01", time: "10:00", zone: "МСК" }, files: [], unreadable: [], requirements: groups, ...over,
  };
}

test("«Что подать» по закону: у организации по 223-ФЗ устав и выписку прикладывают, у ИП устава нет, на площадке выписку передаёт ЕИС", () => {
  const items = [
    draft("Копия устава участника закупки"),
    draft("Выписка из ЕГРЮЛ, полученная не ранее чем за 30 календарных дней до даты окончания подачи заявок"),
    draft("Реквизиты расчётного счёта участника"),
  ];
  const ul = needsOfPurchase(purchase("223-ФЗ · запрос котировок в электронной форме", items), { ...EMPTY_PROFILE, inn: "7707083893" });
  const labels = ul.flatMap((x) => x.needs.map((n) => [n.kind, n.label, n.freshnessDays]));
  assert.deepEqual(labels, [
    ["document", "Устав", undefined],
    ["document", "Выписка из ЕГРЮЛ или ЕГРИП", 30],
    ["requisite", "Реквизиты счёта", undefined],
  ]);
  assert.deepEqual(ul[2].needs[0].requisites, ["account", "bankName", "bik", "corrAccount"]);

  const ip = needsOfPurchase(purchase("223-ФЗ · запрос котировок в электронной форме", items), { ...EMPTY_PROFILE, inn: "770708389312" });
  assert.deepEqual(ip.map((x) => x.needs.length), [0, 1, 1], "у ИП устава нет");

  const platform = needsOfPurchase(purchase("44-ФЗ · электронный аукцион", items), EMPTY_PROFILE);
  assert.deepEqual(platform[1].needs, [], "выписку из ЕГРЮЛ по 44-ФЗ передаёт площадка");
});

test("критерии оценки — потребности «за баллы»: опыт и специалисты", () => {
  const p = purchase("44-ФЗ · электронный конкурс", [], {
    criteria: {
      howWins: "points",
      rows: [
        { criterion: "Цена контракта", criterionWeight: "60 %", indicator: "", indicatorWeight: "", detail: "", detailWeight: "", scoring: "Чем ниже, тем больше", proof: "", form: "", source: "Порядок", quote: "Цена", verified: true },
        {
          criterion: "Квалификация участников", criterionWeight: "30 %", indicator: "Наличие опыта оказания услуги", indicatorWeight: "50 %", detail: "Общая цена исполненных договоров", detailWeight: "100 %",
          scoring: "От 3 млн руб. — 100 баллов", proof: "Исполненные договоры и акты о приёмке", form: "", source: "Порядок", quote: "Договоры", verified: true,
        },
        {
          criterion: "Квалификация участников", criterionWeight: "30 %", indicator: "Наличие специалистов", indicatorWeight: "50 %", detail: "Количество специалистов", detailWeight: "100 %",
          scoring: "Четыре и более — 100 баллов", proof: "Копии дипломов и удостоверений", form: "", source: "Порядок", quote: "Специалисты", verified: true,
        },
      ],
    },
  });
  const all = needsOfPurchase(p);
  assert.deepEqual(all.map((x) => x.needs.map((n) => [n.kind, n.optional, n.scoring])), [[], [["experience", true, true]], [["employee", true, true]]]);
  assert.deepEqual(all[1].needs[0].measures, [], "условия шкалы баллов — не порог допуска");
  assert.equal(all[1].needs[0].basis, "Критерий оценки");
});

test("опыт: период и пороги читаются из требования", () => {
  const needs = needsOf({
    id: "who-9",
    requirement: req(
      "Опыт исполнения не менее 3 контрактов за последние 3 года, цена каждого не менее 20 % начальной цены, общая цена не менее 3 000 000 руб.",
      "who"
    ),
  });
  assert.equal(needs[0].kind, "experience");
  assert.equal(needs[0].windowMonths, 36);
  assert.deepEqual(needs[0].measures.map((c) => [c.value, c.unit]).sort(), [[20, "%"], [3, "контрактов"], [3000000, "руб"]].sort());
});
