// Требование → доказательство → проверка: что есть у компании и подходит ли — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConditions } from "./conditions.ts";
import { makeFact, type Fact, type FactInput } from "./evidence-base.ts";
import { checkNeed, checkPurchase, gapsOf, matches, onDateOf, worst, type Base, type When } from "./evidence-match.ts";
import { type Need } from "./evidence-need.ts";
import { EMPTY_PROFILE } from "./profile.ts";
import type { Purchase } from "./purchase.ts";
import { refineGroups } from "./requirement-engine.ts";
import type { DraftItem } from "./requirements.ts";

const NOW = new Date("2026-10-01T10:00:00Z");
let n = 0;
const fact = (input: FactInput, over: Partial<Fact> = {}): Fact => ({ ...makeFact(input, NOW, `f${++n}`), ...over });
const doc = (docName = "Файл.pdf", quote = ""): FactInput["source"] => ({ type: "document", docId: "d1", docName, quote });

const need = (over: Partial<Need> = {}): Need => ({
  id: "who-0#0", kind: "license", label: "Лицензия на образовательную деятельность", proof: "document", stems: ["образ"], anyOf: [], measures: [],
  optional: false, scoring: false, basis: "Требование к участнику", requirement: { id: "who-0", group: "who", text: "Лицензия" }, ...over,
});

const base = (facts: Fact[], profile = EMPTY_PROFILE): Base => ({ facts, profile });
const ON: When = { on: "2026-11-01" };
const cond = (text: string) => parseConditions(text)[0];

const license = (over: Partial<FactInput> = {}) =>
  fact({ kind: "license", title: "Лицензия на образовательную деятельность № Л035", source: doc("Лицензия.pdf", "Лицензия № Л035"), validity: { perpetual: true }, ...over });

test("лицензии нет в базе — «нет доказательства», а не догадка; есть другая — сказано, какая", () => {
  const none = checkNeed(need(), base([]), ON);
  assert.equal(none.status, "needs_evidence");
  assert.match(none.reasons[0], /В базе нет: лицензия на образовательную деятельность/);
  const other = checkNeed(need(), base([fact({ kind: "license", title: "Лицензия на медицинскую деятельность", source: doc(), validity: { perpetual: true } })]), ON);
  assert.equal(other.status, "needs_evidence");
  assert.match(other.reasons[0], /есть другое \(«Лицензия на медицинскую деятельность»\).*отметьте ниже/);
});

test("лицензия с документом и сроком — подтверждена; без файла — всё равно «нет доказательства»: слова человека документом не считаются", () => {
  const ok = checkNeed(need(), base([license()]), ON);
  assert.deepEqual([ok.status, ok.facts.length], ["ok", 1]);
  const manual = checkNeed(need(), base([license({ source: { type: "manual" } })]), ON);
  assert.equal(manual.status, "needs_evidence");
  assert.match(manual.reasons[0], /вписано без документа/);
  // А если требование — число или слово компании, а не копия документа, слов человека хватает.
  const statement = checkNeed(need({ proof: "statement" }), base([license({ source: { type: "manual" } })]), ON);
  assert.equal(statement.status, "ok");
});

test("срок на дату подачи: действует, скоро кончится, просрочен, ещё не начался, не указан", () => {
  const status = (validity: Fact["validity"]) => checkNeed(need(), base([license({ validity })]), ON).status;
  assert.equal(status({ until: "2027-06-30" }), "ok");
  assert.equal(status({ until: "2026-11-20" }), "expiring", "кончится через 19 дней после подачи");
  assert.equal(status({ until: "2026-10-31" }), "expired", "накануне подачи уже не действует");
  assert.equal(status({ from: "2027-01-01", until: "2028-01-01" }), "mismatch");
  assert.equal(status({}), "need_human", "у лицензии срок обязателен: бессрочно или дата");
  const expired = checkNeed(need(), base([license({ validity: { until: "2026-10-31" } })]), ON);
  assert.match(expired.reasons[0], /просрочен: действовал до 31\.10\.2026, на 01\.11\.2026 уже нет/);
});

test("найденное ИИ ждёт человека: само по себе не доказательство", () => {
  const ai = license({ origin: "ai", source: doc("Лицензия.pdf", "Лицензия № Л035") });
  const r = checkNeed(need(), base([ai]), ON);
  assert.equal(r.status, "need_human");
  assert.match(r.reasons[0], /нашёл ИИ в «Лицензия\.pdf» — проверьте и подтвердите/);
  const confirmed = { ...ai, confirmed: true };
  assert.equal(checkNeed(need(), base([confirmed]), ON).status, "ok");
});

test("из нескольких фактов берётся лучший: просроченная и действующая лицензии — подтверждено; просроченная и неподтверждённая — решает человек", () => {
  const old = license({ title: "Лицензия на образовательную деятельность (старая)", validity: { until: "2025-01-01" } });
  const fresh = license({ title: "Лицензия на образовательную деятельность (новая)", validity: { until: "2030-01-01" } });
  const r = checkNeed(need(), base([old, fresh]), ON);
  assert.equal(r.status, "ok");
  assert.equal(r.facts[0].title, "Лицензия на образовательную деятельность (новая)");
  const unconfirmed = license({ title: "Лицензия на образовательную деятельность (найдена ИИ)", origin: "ai", validity: { until: "2030-01-01" } });
  assert.equal(checkNeed(need(), base([old, unconfirmed]), ON).status, "need_human");
});

test("требование не называет, какая лицензия нужна, а в базе их несколько — решает человек, а не «подходит»", () => {
  const vague = need({ stems: [], label: "Лицензия или допуск" });
  const a = license({ title: "Лицензия А" });
  const b = license({ title: "Лицензия Б" });
  assert.equal(checkNeed(vague, base([a]), ON).status, "ok");
  const two = checkNeed(vague, base([a, b]), ON);
  assert.equal(two.status, "need_human");
  assert.match(two.reasons.join(" "), /не сказано, какой именно документ нужен/);
});

test("предмет по словам и номерам: «образовательную» совпадает с «образовательной», ISO 14001 — не ISO 9001", () => {
  assert.equal(matches(need(), license({ title: "Лицензия на образовательной деятельности" })), true);
  assert.equal(matches(need(), license({ title: "Лицензия на медицинскую деятельность" })), false);
  const iso = need({ kind: "certificate", stems: ["iso", "9001"], label: "Сертификат ISO 9001" });
  assert.equal(matches(iso, fact({ kind: "certificate", title: "Сертификат ISO 9001:2015" })), true);
  assert.equal(matches(iso, fact({ kind: "certificate", title: "Сертификат ISO 14001:2015" })), false);
  assert.equal(matches(iso, fact({ kind: "license", title: "ISO 9001" })), false, "другой вид факта не подходит");
});

test("выписка: свежесть считается от даты подачи — старше срока заказчика просрочена, без даты — решает человек", () => {
  const extract = need({ kind: "document", label: "Выписка из ЕГРЮЛ или ЕГРИП", stems: [], anyOf: ["выпис", "егрюл", "егрип"], freshnessDays: 30 });
  const doc1 = (issuedAt?: string) => fact({ kind: "document", title: "Выписка из ЕГРЮЛ", source: doc(), fields: issuedAt ? { issuedAt } : {} });
  assert.equal(checkNeed(extract, base([doc1("2026-10-15")]), ON).status, "ok");
  const old = checkNeed(extract, base([doc1("2026-08-01")]), ON);
  assert.equal(old.status, "expired");
  assert.match(old.reasons[0], /от 01\.08\.2026: на дату подачи ему 92 дня, заказчик просит не старше 30 дней/);
  assert.equal(checkNeed(extract, base([doc1()]), ON).status, "need_human");
});

test("оборудование: число заказчика сверяется с числом компании — меньше нужного «не подходит», нужного нет — решает человек, фактов нет — «нет доказательства»", () => {
  const hall = need({ kind: "equipment", label: "Зал", stems: ["зал"], proof: "statement", measures: [cond("не менее 150 мест")] });
  const eq = (title: string, value?: number) =>
    fact({ kind: "equipment", title, measures: value === undefined ? [] : [{ what: "вместимость", value, unit: "мест" }] });
  const small = checkNeed(hall, base([eq("Зал «Галерея»", 120)]), ON);
  assert.equal(small.status, "mismatch");
  assert.match(small.reasons[0], /вместимость — 120 мест, а по требованию не менее 150 мест/);
  const big = checkNeed(hall, base([eq("Зал «Галерея»", 120), eq("Актовый зал", 200)]), ON);
  assert.deepEqual([big.status, big.facts[0].title], ["ok", "Актовый зал"]);
  assert.equal(checkNeed(hall, base([eq("Актовый зал")]), ON).status, "need_human");
  assert.equal(checkNeed(hall, base([]), ON).status, "needs_evidence");
  // Размеры «3×2» сравнивать с одним числом нельзя — смотрит человек.
  const screen = need({ kind: "equipment", stems: ["экран"], proof: "statement", measures: [cond("экран не менее 3×2 м")] });
  assert.equal(checkNeed(screen, base([fact({ kind: "equipment", title: "Светодиодный экран", measures: [{ what: "ширина", value: 4, unit: "м" }] })]), ON).status, "need_human");
});

const contract = (title: string, actDate: string | undefined, price: number | undefined, over: Partial<Fact> = {}) =>
  fact(
    {
      kind: "experience",
      title,
      fields: { subject: "Организация мероприятия", ...(actDate && { actDate }), ...(actDate && { actNo: "1" }) },
      measures: price === undefined ? [] : [{ what: "цена договора", value: price, unit: "руб" }],
      source: doc("Договор.pdf"),
    },
    over
  );

test("опыт: считаются договоры с актом в нужном периоде; хватает — подтверждено, не хватает — «не подходит» с числами", () => {
  const exp = need({ kind: "experience", label: "Опыт", stems: [], proof: "document", windowMonths: 36, measures: [cond("не менее 3 договоров")] });
  const enough = [contract("Договор 1", "2026-06-25", 1_200_000), contract("Договор 2", "2025-09-10", 800_000), contract("Договор 3", "2024-02-01", 500_000)];
  assert.equal(checkNeed(exp, base(enough), ON).status, "ok");
  const few = checkNeed(exp, base(enough.slice(0, 2)), ON);
  assert.equal(few.status, "mismatch");
  assert.match(few.reasons.join(" "), /подходящих договоров 2, а нужно не менее 3 договоров/);
  // Договор без акта и договор вне периода не считаются, и об этом сказано.
  const mixed = checkNeed(exp, base([...enough.slice(0, 2), contract("Без акта", undefined, 900_000), contract("Старый", "2020-01-01", 900_000)]), ON);
  assert.equal(mixed.status, "mismatch");
  assert.match(mixed.reasons.join(" "), /«Без акта»: нет акта о приёмке/);
  assert.match(mixed.reasons.join(" "), /«Старый»: акт от 01\.01\.2020 — вне периода/);
});

test("опыт: сумма и цена каждого договора от начальной цены; нет цены или даты акта — решает человек; нет договоров — «нет доказательства»", () => {
  const sum = need({ kind: "experience", label: "Опыт", stems: [], measures: [cond("общая цена не менее 3 000 000 руб.")] });
  const c3 = [contract("А", "2026-01-10", 2_000_000), contract("Б", "2026-02-10", 1_500_000)];
  assert.equal(checkNeed(sum, base(c3), ON).status, "ok");
  const fail = checkNeed(sum, base([c3[0]]), ON);
  assert.match(fail.reasons.join(" "), /общая цена подходящих договоров 2\s?000\s?000 руб\., а нужно не менее 3\s?000\s?000 руб\./);

  const each = need({ kind: "experience", label: "Опыт", stems: [], measures: [cond("цена каждого не менее 20 % начальной цены"), cond("не менее 2 договоров")] });
  const withNmck: When = { on: "2026-11-01", nmck: 1_000_000 };
  const r = checkNeed(each, base([contract("Крупный", "2026-01-10", 400_000), contract("Мелкий", "2026-02-10", 100_000), contract("Без цены", "2026-03-10", undefined)]), withNmck);
  assert.equal(r.status, "need_human");
  assert.match(r.reasons.join(" "), /«Мелкий»: цена 100\s?000 руб\. меньше 200\s?000 руб\./);
  assert.match(r.reasons.join(" "), /«Без цены»: не указана цена договора/);
  assert.equal(checkNeed(each, base([contract("Крупный", "2026-01-10", 400_000)]), ON).status, "need_human", "процент от начальной цены, а цена закупки не известна");
  assert.equal(checkNeed(sum, base([]), ON).status, "needs_evidence");
});

test("опыт: договор, найденный ИИ, и договор не по предмету — решает человек, а не засчитывается", () => {
  const exp = need({ kind: "experience", label: "Опыт", stems: ["меропр"], measures: [cond("не менее 1 договора")] });
  assert.equal(checkNeed(exp, base([contract("Договор", "2026-01-10", 1, { origin: "ai", confirmed: false })]), ON).status, "need_human");
  const other = fact({ kind: "experience", title: "Поставка бумаги", fields: { subject: "Поставка бумаги", actDate: "2026-01-10", actNo: "2" }, measures: [], source: doc() });
  const r = checkNeed(exp, base([other]), ON);
  assert.equal(r.status, "need_human");
  assert.match(r.reasons.join(" "), /по предмету не видно/);
});

test("сотрудники: подходящих по документам считается по людям, просроченное удостоверение не в счёт", () => {
  const staff = need({ kind: "employee", label: "Специалисты", stems: ["электро"], measures: [cond("не менее 2 специалистов")] });
  const q = (holder: string, until: string) =>
    fact({ kind: "qualification", title: `Удостоверение по электробезопасности, ${holder}`, fields: { holder }, validity: { until }, source: doc("Удостоверение.pdf") });
  const two = checkNeed(staff, base([q("Иванов И. И.", "2028-01-01"), q("Петров П. П.", "2029-01-01")]), ON);
  assert.deepEqual([two.status, two.reasons[0]], ["ok", "Подходящих специалистов: 2"]);
  const one = checkNeed(staff, base([q("Иванов И. И.", "2028-01-01"), q("Петров П. П.", "2025-01-01")]), ON);
  assert.equal(one.status, "mismatch");
  assert.match(one.reasons.join(" "), /подходящих специалистов 1, а нужно не менее 2 специалистов/);
  assert.match(one.reasons.join(" "), /просрочен/);
  assert.equal(checkNeed(staff, base([]), ON).reasons[0], "В базе нет ни сотрудников, ни их документов.");
  // Один человек с двумя документами — один специалист.
  const dup = checkNeed(staff, base([q("Иванов И. И.", "2028-01-01"), q("Иванов И. И.", "2029-01-01")]), ON);
  assert.equal(dup.status, "mismatch");
});

test("реквизиты: не заполнено — «нет доказательства» (система не подставляет), не сходятся контрольные цифры — решает человек, всё верно — подтверждено", () => {
  const bank = need({ kind: "requisite", label: "Реквизиты счёта", proof: "statement", stems: [], requisites: ["account", "bankName", "bik", "corrAccount"] });
  const empty = checkNeed(bank, base([]), ON);
  assert.equal(empty.status, "needs_evidence");
  assert.match(empty.reasons.join(" "), /не заполнено: расчётный счёт/);
  const typo = checkNeed(bank, base([], { ...EMPTY_PROFILE, account: "40702810900000000001", bankName: "Банк", bik: "044525225", corrAccount: "30101810400000000225" }), ON);
  assert.equal(typo.status, "need_human");
  assert.match(typo.reasons.join(" "), /расчётный счёт: Счёт не сходится с БИК/);
  const inn = need({ kind: "requisite", label: "Сведения об участнике", proof: "statement", stems: [], requisites: ["inn"] });
  assert.equal(checkNeed(inn, base([], { ...EMPTY_PROFILE, inn: "7707083893" }), ON).status, "ok");
});

test("худший из статусов; дата проверки — срок подачи, а без него сегодня", () => {
  assert.equal(worst(["ok", "need_human", "expiring"]), "need_human");
  assert.equal(worst(["ok", "needs_evidence", "expired"]), "expired");
  assert.equal(worst([]), "ok");
  assert.equal(onDateOf({ date: "2026-11-01" }, "2026-10-01"), "2026-11-01");
  assert.equal(onDateOf({ date: "" }, "2026-10-01"), "2026-10-01");
  assert.equal(onDateOf({ date: "31.11.2026" }, "2026-10-01"), "2026-10-01");
});

const draft = (text: string, over: Partial<DraftItem> = {}): DraftItem => ({
  text, source: "Извещение", quote: text, mandatory: "required", type: "participant", deadline: "", numbers: [], check: "", evidence: [], ...over,
});

function purchase(id: string, who: DraftItem[], over: Partial<Purchase> = {}): Purchase {
  return {
    id, createdAt: "2026-10-01T10:00:00.000Z", short: `Закупка ${id}`, subject: "", kind: "44-ФЗ · электронный аукцион", customer: "", price: "1 000 000",
    deadline: { date: "2026-11-01", time: "10:00", zone: "МСК" }, files: [], unreadable: [],
    requirements: refineGroups({ price: "1 000 000", who, submit: [], scope: [], terms: [] }, () => true), ...over,
  };
}

test("закупка целиком: каждому требованию — что нужно и что с этим в базе; дата проверки — срок подачи закупки", () => {
  const p = purchase("p1", [draft("Наличие лицензии на образовательную деятельность"), draft("Начальная цена — 685 000 ₽", { type: "money" })]);
  const empty = checkPurchase(p, base([]), "2026-10-01");
  assert.deepEqual(empty.map((x) => x.checks.map((c) => c.status)), [["needs_evidence"], []]);
  const withLicense = checkPurchase(p, base([license({ validity: { until: "2026-10-20" } })]), "2026-10-01");
  assert.equal(withLicense[0].checks[0].status, "expired", "до подачи 1 ноября лицензия уже кончится");
  const later = checkPurchase({ ...p, deadline: { date: "2026-10-10", time: "", zone: "" } }, base([license({ validity: { until: "2026-10-20" } })]), "2026-10-01");
  assert.equal(later[0].checks[0].status, "expiring");
});

test("пробелы по всем закупкам: одна потребность — одна строка, закупки перечислены, берётся худший статус", () => {
  const items = [draft("Наличие лицензии на образовательную деятельность")];
  const p1 = purchase("p1", items);
  const p2 = purchase("p2", items, { deadline: { date: "2027-06-01", time: "", zone: "" } });
  const gaps = gapsOf([p1, p2], base([license({ validity: { until: "2026-12-31" } })]), "2026-10-01");
  assert.equal(gaps.length, 1);
  assert.deepEqual(
    [gaps[0].kind, gaps[0].status, gaps[0].purchases.map((p) => p.title), gaps[0].optional],
    ["license", "expired", ["Закупка p1", "Закупка p2"], false],
    "для второй закупки лицензия к подаче уже кончится — худший статус"
  );
  assert.equal(gapsOf([], base([]), "2026-10-01").length, 0);
  // Откуда потребность: из какого требования. Одинаковое требование двух закупок называется один раз.
  assert.deepEqual(gaps[0].from, [{ basis: "Требование к участнику", text: "Наличие лицензии на образовательную деятельность" }]);
});

test("пробелы: две закупки с одним требованием — закупка названа один раз; разные требования с одной потребностью — все названы", () => {
  const a = draft("Наличие лицензии на образовательную деятельность");
  // То же требование другим текстом (из другого документа): потребность та же, а откуда она — два места.
  const b = draft("Наличие лицензии на образовательную деятельность.", { source: "Информационная карта" });
  const p1 = purchase("p1", [a, b]);
  const gaps = gapsOf([p1, p1], base([]), "2026-10-01");
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0].purchases.map((p) => p.id), ["p1"], "одна закупка — один раз, хоть требований и потребностей несколько");
  assert.deepEqual(gaps[0].from.map((f) => f.text), [a.text, b.text]);
});
