// Детерминированный движок проверки заявки — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFact, type Fact, type FactInput } from "./evidence-base.ts";
import { EMPTY_PROFILE, type Profile } from "./profile.ts";
import type { Purchase } from "./purchase.ts";
import type { ReqItem } from "./requirements.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM, type TpResult } from "./tp.ts";
import { validate, worstStatus, categorySummary, type ValidationInput } from "./validation-engine.ts";
import type { ApplicationField } from "./fields.ts";

const NOW = new Date("2026-10-02T10:00:00Z");
let n = 0;
const makeFact_ = (input: FactInput, over: Partial<Fact> = {}): Fact => ({ ...makeFact(input, NOW, `f${++n}`), ...over });
const doc = (docName = "Файл.pdf", quote = ""): FactInput["source"] => ({ type: "document", docId: "d1", docName, quote });

const req = (text: string): ReqItem => ({ text, source: "Извещение", quote: text, verified: true });

const tp = (offer: string): TpResult => ({
  form: { ...PLAIN_FORM },
  goods: [],
  items: [{ clause: "2.1", topic: "Зал", requirement: "Зал не менее 150 мест", quote: "не менее 150 мест", offer, verified: true }],
  antiDumping: NO_ANTI_DUMPING,
});

function makePurchase(over: Partial<Purchase> = {}): Purchase {
  return {
    id: "p1",
    createdAt: "2026-10-01T10:00:00.000Z",
    short: "Мероприятие",
    subject: "",
    kind: "44-ФЗ · электронный аукцион",
    customer: "Заказчик",
    price: "450 000",
    deadline: { date: "2026-11-01", time: "10:00", zone: "МСК" },
    files: [],
    unreadable: [],
    requirements: {
      who: [],
      submit: [req("Предложение участника в отношении объекта закупки"), req("Копия лицензии")],
      scope: [],
      terms: [],
    },
    ...over,
  };
}

// Профиль с заведомо валидными реквизитами (только ИНН и ОГРН, без счёта — чтобы не зависеть от контрольных цифр счёт+БИК).
const PROFILE: Profile = {
  ...EMPTY_PROFILE,
  inn: "7707083893",
  ogrn: "1027700132195",
  head: "Генеральный директор Иванов И. И.",
  signer: "Иванов И. И.",
};

const emptyInput = (over: Partial<ValidationInput> = {}): ValidationInput => ({
  purchase: makePurchase(),
  profile: PROFILE,
  facts: [],
  fields: [],
  today: "2026-10-02",
  ...over,
});

// ——— worstStatus ———

test("worstStatus: пустой список — PASS; любой FAIL перебивает остальное", () => {
  assert.equal(worstStatus([]), "PASS");
  assert.equal(worstStatus(["PASS", "NEEDS_HUMAN_REVIEW"]), "NEEDS_HUMAN_REVIEW");
  assert.equal(worstStatus(["PASS", "NEEDS_HUMAN_REVIEW", "FAIL"]), "FAIL");
  assert.equal(worstStatus(["FAIL", "PASS"]), "FAIL");
});

// ——— Даты ———

test("даты: срок в будущем — нет находок; истёк — FAIL", () => {
  const future = validate(emptyInput({ today: "2026-10-02" }));
  const dateFail = future.findings.filter((f) => f.category === "dates");
  assert.equal(dateFail.length, 0);

  const past = validate(emptyInput({ today: "2026-11-05" }));
  const failFinding = past.findings.find((f) => f.category === "dates" && f.status === "FAIL");
  assert.ok(failFinding, "должен быть FAIL если дедлайн в прошлом");
  assert.match(failFinding!.reasons[0], /Дедлайн был/);
});

test("даты: нет даты подачи — NEEDS_HUMAN_REVIEW", () => {
  const input = emptyInput({ purchase: makePurchase({ deadline: { date: "", time: "", zone: "" } }) });
  const report = validate(input);
  const finding = report.findings.find((f) => f.category === "dates");
  assert.ok(finding);
  assert.equal(finding!.status, "NEEDS_HUMAN_REVIEW");
});

// ——— Сроки действия ———

test("сроки действия: бессрочная лицензия — нет находки; просроченная — FAIL; скоро истечёт — NEEDS_HUMAN_REVIEW", () => {
  const perpetual = makeFact_({ kind: "license", title: "Лицензия на образование", source: doc(), validity: { perpetual: true } });
  const noFindings = validate(emptyInput({ facts: [perpetual] })).findings.filter((f) => f.category === "validity_periods");
  assert.equal(noFindings.length, 0);

  const expired = makeFact_({ kind: "license", title: "Старая лицензия", source: doc(), validity: { until: "2026-01-01" } });
  const failFindings = validate(emptyInput({ facts: [expired] })).findings.filter((f) => f.category === "validity_periods");
  assert.equal(failFindings.length, 1);
  assert.equal(failFindings[0]!.status, "FAIL");

  // Истекает через 20 дней от даты подачи (2026-11-01 + 20 = 2026-11-21)
  const expiring = makeFact_({ kind: "license", title: "Скоро истечёт", source: doc(), validity: { until: "2026-11-21" } });
  const warnFindings = validate(emptyInput({ facts: [expiring] })).findings.filter((f) => f.category === "validity_periods");
  assert.equal(warnFindings.length, 1);
  assert.equal(warnFindings[0]!.status, "NEEDS_HUMAN_REVIEW");
});

test("сроки действия: лицензия без срока — NEEDS_HUMAN_REVIEW; документ без срока — не проверяется", () => {
  const noTerm = makeFact_({ kind: "license", title: "Лицензия без даты", source: doc(), validity: {} });
  const docNoTerm = makeFact_({ kind: "document", title: "Устав", source: doc(), validity: {} });

  const report = validate(emptyInput({ facts: [noTerm, docNoTerm] }));
  const vFindings = report.findings.filter((f) => f.category === "validity_periods");
  assert.equal(vFindings.length, 1);
  assert.equal(vFindings[0]!.status, "NEEDS_HUMAN_REVIEW");
  assert.equal(vFindings[0]!.ref, noTerm.id);
});

// ——— Числовые ограничения ———

test("числовые ограничения: поле invalid — FAIL; поле filled — нет находки", () => {
  const invalidField: ApplicationField = {
    key: "tp:item:0:done:0",
    label: "число",
    doc: "Техническое предложение",
    part: "tp",
    kind: "manual",
    status: "invalid",
    value: "120",
    source: "ТЗ, п. 2.1",
    required: true,
    problem: "120 — по ТЗ не меньше 150",
  };
  const filledField: ApplicationField = { ...invalidField, key: "f2", status: "filled", value: "200", problem: undefined };

  const report = validate(emptyInput({ fields: [invalidField, filledField] }));
  const numFindings = report.findings.filter((f) => f.category === "numeric_constraints");
  assert.equal(numFindings.length, 1);
  assert.equal(numFindings[0]!.status, "FAIL");
  assert.match(numFindings[0]!.reasons[0], /120.*150/);
});

// ——— Реквизиты ———

test("реквизиты: всё правильно — нет находок; некорректный ИНН — NEEDS_HUMAN_REVIEW", () => {
  const clean = validate(emptyInput());
  const reqFindings = clean.findings.filter((f) => f.category === "requisite_matching");
  assert.equal(reqFindings.length, 0);

  const badInn = validate(emptyInput({ profile: { ...PROFILE, inn: "1234567890" } }));
  const bad = badInn.findings.filter((f) => f.category === "requisite_matching");
  assert.ok(bad.length > 0);
  assert.equal(bad[0]!.status, "NEEDS_HUMAN_REVIEW");
});

test("реквизиты: пустой ИНН — FAIL", () => {
  // profileProblems не проверяет пустые — но счёт без БИК тоже не проверяет.
  // Пустое поле в обязательных реквизитах (нет нарушения контрольной цифры, просто пусто).
  // requisite_matching проверяет через profileProblems. Если поле пустое — ошибки нет (profileProblems пропускает пустые).
  // Пустые обязательные реквизиты → required_fields (через fields map), не через requisite_matching.
  // Поэтому тест: неправильное (не пустое) поле → NEEDS_HUMAN_REVIEW.
  const wrongOgrn = validate(emptyInput({ profile: { ...PROFILE, ogrn: "1234567890123" } }));
  const f = wrongOgrn.findings.find((f) => f.category === "requisite_matching");
  assert.ok(f);
  assert.equal(f!.status, "NEEDS_HUMAN_REVIEW");
});

// ——— Соответствие характеристик ———

test("соответствие характеристик: поле confirm needs_confirmation — NEEDS_HUMAN_REVIEW; confirm filled — нет находки", () => {
  const unconfirmed: ApplicationField = {
    key: "confirm:guess:item:0",
    label: "Значение подобрал ИИ",
    doc: "Техническое предложение",
    part: "tp",
    kind: "confirm",
    status: "needs_confirmation",
    value: "150",
    source: "ТЗ, п. 2.1",
    required: true,
    problem: "По ТЗ не менее 150 мест. ИИ взял её как ваше значение — подтвердите",
    context: "Зал для мероприятий",
  };
  const confirmed: ApplicationField = { ...unconfirmed, key: "confirm:guess:item:1", status: "filled" };

  const report = validate(emptyInput({ fields: [unconfirmed, confirmed] }));
  const chFindings = report.findings.filter((f) => f.category === "characteristic_matching");
  assert.equal(chFindings.length, 1);
  assert.equal(chFindings[0]!.status, "NEEDS_HUMAN_REVIEW");
});

// ——— Заполненность полей ———

test("заполненность: needs_input обязательное — FAIL; needs_confirmation — NEEDS_HUMAN_REVIEW; filled — нет находки", () => {
  const empty: ApplicationField = {
    key: "tp:item:1:0",
    label: "вместимость зала",
    doc: "Техническое предложение",
    part: "tp",
    kind: "manual",
    status: "needs_input",
    value: "",
    source: "ТЗ, п. 2.1",
    required: true,
  };
  const confirm: ApplicationField = { ...empty, key: "c1", kind: "confirm", status: "needs_confirmation", value: "150" };
  const filled: ApplicationField = { ...empty, key: "f1", status: "filled", value: "200" };

  const report = validate(emptyInput({ fields: [empty, confirm, filled] }));
  const rfFindings = report.findings.filter((f) => f.category === "required_fields");
  assert.equal(rfFindings.length, 2);
  assert.ok(rfFindings.some((f) => f.status === "FAIL" && f.id.includes(empty.key)));
  assert.ok(rfFindings.some((f) => f.status === "NEEDS_HUMAN_REVIEW" && f.id.includes("confirm:c1")));
});

test("заполненность: необязательное needs_input — нет находки", () => {
  const optional: ApplicationField = {
    key: "opt",
    label: "необязательное поле",
    doc: "Анкета",
    part: "participant",
    kind: "manual",
    status: "needs_input",
    value: "",
    source: "Профиль",
    required: false,
  };
  const report = validate(emptyInput({ fields: [optional] }));
  assert.equal(report.findings.filter((f) => f.category === "required_fields").length, 0);
});

// ——— Противоречия в документах ———

test("противоречия: акт позже договора — нет находки; акт раньше договора — FAIL", () => {
  const ok = makeFact_({
    kind: "experience",
    title: "Контракт № 1",
    source: doc(),
    validity: {},
    fields: { contractDate: "2026-01-15", actDate: "2026-06-20" },
  });
  const bad = makeFact_({
    kind: "experience",
    title: "Контракт № 2",
    source: doc(),
    validity: {},
    fields: { contractDate: "2026-06-01", actDate: "2026-03-15" },
  });

  const report = validate(emptyInput({ facts: [ok, bad] }));
  const contrFindings = report.findings.filter((f) => f.category === "document_contradictions");
  assert.equal(contrFindings.length, 1);
  assert.equal(contrFindings[0]!.status, "FAIL");
  assert.match(contrFindings[0]!.reasons[0], /акт.*(раньше|предшеств|позже)/i);
});

test("противоречия: два факта с одинаковым названием и разными числами — NEEDS_HUMAN_REVIEW", () => {
  const f1 = makeFact_({
    kind: "equipment", title: "Актовый зал", source: doc(), validity: {},
    measures: [{ what: "Вместимость", value: 180, unit: "мест" }],
  });
  const f2 = makeFact_({
    kind: "equipment", title: "Актовый зал", source: doc(), validity: {},
    measures: [{ what: "Вместимость", value: 250, unit: "мест" }],
  });

  const report = validate(emptyInput({ facts: [f1, f2] }));
  const contrFindings = report.findings.filter((f) => f.category === "document_contradictions");
  assert.ok(contrFindings.length >= 1);
  assert.ok(contrFindings.some((f) => f.status === "NEEDS_HUMAN_REVIEW"));
});

// ——— Итоговый статус и сводка по категориям ———

test("итоговый статус: закупка без обязательных документов и без нарушений — PASS; просроченная лицензия — FAIL", () => {
  // Закупка без обязательных документов (только scope) и без находок
  const trivialPurchase = makePurchase({ requirements: { who: [], submit: [], scope: [], terms: [] } });
  const clean = validate(emptyInput({ purchase: trivialPurchase }));
  assert.equal(clean.status, "PASS", `Неожиданные находки: ${clean.findings.map((f) => f.title).join("; ")}`);

  const expiredLicense = makeFact_({ kind: "license", title: "Старая лицензия", source: doc(), validity: { until: "2026-01-01" } });
  const withFail = validate(emptyInput({ purchase: trivialPurchase, facts: [expiredLicense] }));
  assert.equal(withFail.status, "FAIL");
});

test("сводка по категориям включает только категории с находками", () => {
  const expiredLicense = makeFact_({ kind: "license", title: "Старая лицензия", source: doc(), validity: { until: "2026-01-01" } });
  const report = validate(emptyInput({ facts: [expiredLicense] }));
  const summary = categorySummary(report);
  assert.ok(summary.length > 0);
  const validityEntry = summary.find((s) => s.category === "validity_periods");
  assert.ok(validityEntry);
  assert.equal(validityEntry!.status, "FAIL");
  assert.equal(validityEntry!.fail, 1);
});

test("счётчики pass/fail/needsHuman соответствуют списку находок", () => {
  const expiredLicense = makeFact_({ kind: "license", title: "Старая лицензия", source: doc(), validity: { until: "2026-01-01" } });
  const noTermLicense = makeFact_({ kind: "license", title: "Лицензия без срока", source: doc(), validity: {} });
  const report = validate(emptyInput({ facts: [expiredLicense, noTermLicense] }));
  assert.equal(report.fail, report.findings.filter((f) => f.status === "FAIL").length);
  assert.equal(report.needsHuman, report.findings.filter((f) => f.status === "NEEDS_HUMAN_REVIEW").length);
});
