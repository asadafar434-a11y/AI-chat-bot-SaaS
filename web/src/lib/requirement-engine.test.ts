// Требования как структура: числа и срок сверяются с цитатой, а не с ответом модели — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteChecker } from "./quotes.ts";
import { checkText, needsCheck, refineGroups, refineItem, refineNumbers, requirementOf, supplierChoices } from "./requirement-engine.ts";
import type { DraftItem, DraftNumber, RequirementsDraft } from "./requirements.ts";

const num = (over: Partial<DraftNumber>): DraftNumber => ({ what: "", op: "min", value: 0, value2: 0, unit: "", raw: "", ...over });
const item = (over: Partial<DraftItem>): DraftItem => ({
  text: "Зал от 150 мест",
  source: "ТЗ, п. 2.1",
  quote: "Зал вместимостью не менее 150 мест в пределах города.",
  mandatory: "required",
  type: "service",
  deadline: "",
  numbers: [],
  check: "",
  evidence: [],
  ...over,
});
const ctx = { found: () => true, nmck: null as number | null };

test("числа берутся из слов документа: модель назвала только «что», граница и единица — из цитаты", () => {
  const { numbers, issues } = refineNumbers(
    [num({ what: "вместимость зала", op: "min", value: 150, unit: "мест", raw: "не менее 150 мест" })],
    "Зал вместимостью не менее 150 мест в пределах города."
  );
  assert.deepEqual(issues, []);
  assert.deepEqual(numbers.map((c) => [c.what, c.op, c.value, c.unit, c.raw]), [["вместимость зала", "min", 150, "мест", "не менее 150 мест"]]);
});

test("модель ошиблась в числе или в границе — верно то, что написано в документе", () => {
  const quote = "Зал вместимостью не менее 150 мест, участников не более 200 человек.";
  // Ответ: «не менее 15» и «не более 200 человек» с перепутанной границей.
  const { numbers, issues } = refineNumbers(
    [num({ op: "min", value: 15, unit: "мест", raw: "не менее 15 мест" }), num({ op: "min", value: 200, unit: "человек", raw: "не более 200 человек" })],
    quote
  );
  assert.deepEqual(numbers.map((c) => [c.op, c.value, c.unit]), [["min", 150, "мест"], ["max", 200, "человек"]]);
  assert.equal(issues.length, 1, "выдуманное «15 мест» не попало в условия, и об этом сказано");
  assert.match(issues[0], /не найдено в цитате/);
});

test("условие, которое код не умеет читать, остаётся, если кусок и число есть в цитате; точное значение тоже", () => {
  const quote = "Кофе-брейк на 120 человек, не позднее семи часов утра.";
  const { numbers, issues } = refineNumbers(
    [num({ what: "гостей", op: "exact", value: 120, unit: "человек", raw: "на 120 человек" })],
    quote
  );
  assert.deepEqual(issues, []);
  assert.deepEqual(numbers.map((c) => [c.op, c.value, c.unit]), [["exact", 120, "человек"]]);
  // Кусок не из цитаты или число не из куска — отбрасывается.
  const bad = refineNumbers(
    [num({ op: "exact", value: 130, unit: "человек", raw: "на 130 человек" }), num({ op: "exact", value: 5, raw: "на 120 человек" })],
    quote
  );
  assert.deepEqual(bad.numbers, []);
  assert.equal(bad.issues.length, 2);
});

test("«не менее 1020 и не более 1100» — одно условие, даже если модель записала две границы", () => {
  const quote = "плотность: не менее 1020 г/м2 и не более 1100 г/м2";
  const { numbers, issues } = refineNumbers(
    [num({ what: "плотность", op: "min", value: 1020, unit: "г/м2" }), num({ what: "плотность", op: "max", value: 1100, unit: "г/м2" })],
    quote
  );
  assert.deepEqual(issues, []);
  assert.deepEqual(numbers.map((c) => [c.what, c.op, c.value, c.value2]), [["плотность", "range", 1020, 1100]]);
});

test("число, которое модель не записала, код находит сам: условий не меньше, чем в цитате", () => {
  const { numbers } = refineNumbers([], "Ведущий — с опытом не менее 3 лет; ансамбль не менее 4 музыкантов.");
  assert.deepEqual(numbers.map((c) => [c.value, c.unit]), [[3, "лет"], [4, "музыкантов"]]);
});

test("срок: числа срока должны быть в цитате, иначе срок не принимается", () => {
  const quote = "Дата и время окончания срока подачи заявок: 30.09.2026 10:00 (МСК).";
  const text = "Подать заявку до 30 сентября, 10:00 МСК";
  const ok = refineItem(item({ quote, text, deadline: "до 30.09.2026 10:00 (МСК)" }), "terms", ctx);
  assert.equal(ok.deadline, "до 30.09.2026 10:00 (МСК)");
  assert.equal(ok.issues, undefined);
  const bad = refineItem(item({ quote, text, deadline: "до 05.10.2026 12:00" }), "terms", ctx);
  assert.equal(bad.deadline, "");
  assert.match(bad.issues?.[0] ?? "", /срок «до 05\.10\.2026 12:00» не найден в цитате/);
});

test("число в пересказе, которого нет в цитате, помечается; число словами, дата и посчитанная от цены сумма — нет", () => {
  const quote = "Размер обеспечения исполнения контракта: 5% от цены контракта. Срок — пять рабочих дней, 30.09.2026.";
  const clean = refineItem(
    item({ quote, text: "Обеспечение — 5% (от начальной цены 685 000 ₽ это 34 250 ₽), срок 5 рабочих дней, до 30 сентября" }),
    "terms",
    { ...ctx, nmck: 685000 }
  );
  assert.equal(clean.issues, undefined);
  const wrong = refineItem(item({ quote, text: "Обеспечение — 7%, срок 5 рабочих дней" }), "terms", { ...ctx, nmck: 685000 });
  assert.equal(wrong.issues?.[0], "в пункте есть число 7, которого нет в цитате: сверьте с документом");
  assert.equal(needsCheck({ verified: true, issues: wrong.issues ?? [] }), true);
});

test("цитата не найдена в документах — verified: false; найдена — true", () => {
  const found = quoteChecker(["Зал вместимостью не менее 150 мест в пределах города."]);
  assert.equal(refineItem(item({}), "scope", { found, nmck: null }).verified, true);
  assert.equal(refineItem(item({ quote: "Зал на 500 мест" }), "scope", { found, nmck: null }).verified, false);
});

test("обязательность: слова заказчика «не является основанием для отклонения» сильнее ответа модели", () => {
  const quote = "Предоставление этих документов не является основанием для отклонения заявки.";
  assert.equal(refineItem(item({ quote, mandatory: "required" }), "submit", ctx).mandatory, "optional");
  assert.equal(refineItem(item({ mandatory: "conditional" }), "scope", ctx).mandatory, "conditional");
});

test("тип: «что подать» — всегда документ, «кто участвует» — к участнику, у срока и денег — только свои типы", () => {
  assert.equal(refineItem(item({ type: "product" }), "submit", ctx).type, "document");
  assert.equal(refineItem(item({ type: "product" }), "who", ctx).type, "participant");
  assert.equal(refineItem(item({ type: "product" }), "terms", ctx).type, "other");
  assert.equal(refineItem(item({ type: "money" }), "terms", ctx).type, "money");
  assert.equal(refineItem(item({ type: "product" }), "scope", ctx).type, "product");
});

test("чем подтвердить: пустое и повторы убираются", () => {
  const r = refineItem(item({ evidence: ["  копия лицензии ", "копия лицензии", ""] }), "who", ctx);
  assert.deepEqual(r.evidence, ["копия лицензии"]);
});

test("весь ответ: четыре группы, каждый пункт разобран по своей группе", () => {
  const draft = {
    short: "", subject: "", kind: "", customer: "", price: "685 000 ₽", deadline: { date: "", time: "", zone: "" },
    who: [item({ type: "money" })], submit: [item({})], scope: [item({})], terms: [item({ type: "deadline" })],
    criteria: { howWins: "price", rows: [] },
  } satisfies RequirementsDraft;
  const groups = refineGroups(draft, () => true);
  assert.deepEqual(Object.entries(groups).map(([k, v]) => [k, v[0].type]), [["who", "participant"], ["submit", "document"], ["scope", "service"], ["terms", "deadline"]]);
});

test("старая закупка без полей: числа находятся в цитате без повторного запроса к ИИ, остальное — «не указано»", () => {
  const r = requirementOf({ text: "Зал от 150 мест", source: "ТЗ", quote: "Зал вместимостью не менее 150 мест.", verified: true }, "scope");
  assert.deepEqual([r.mandatory, r.type, r.deadline, r.evidence, r.issues], ["unclear", "service", "", [], []]);
  assert.deepEqual(r.numbers.map((c) => [c.op, c.value, c.unit]), [["min", 150, "мест"]]);
  assert.equal(requirementOf({ text: "Устав", source: "Извещение", quote: "Устав", verified: true }, "submit").type, "document");
  assert.equal(requirementOf({ text: "x", source: "", quote: "Это не является основанием для отклонения заявки", verified: true }, "submit").mandatory, "optional");
});

test("как проверить: граница заказчика — выбор участника, срок заказчика — принимается как написано", () => {
  const r = requirementOf(
    {
      text: "Зал",
      source: "ТЗ",
      quote: "Зал вместимостью не менее 150 мест",
      verified: true,
      numbers: [
        { what: "вместимость", op: "min", value: 150, unit: "мест", raw: "не менее 150 мест" },
        { what: "", op: "max", value: 5, unit: "рабочих дней", raw: "в течение 5 рабочих дней", term: true },
        { what: "гостей", op: "exact", value: 120, unit: "человек", raw: "на 120 человек" },
      ],
      check: "названа площадка",
    },
    "scope"
  );
  assert.deepEqual(supplierChoices(r).map((c) => c.value), [150]);
  assert.equal(
    checkText(r),
    "названа площадка. в предложении участника — вместимость: не менее 150 мест. срок не более 5 рабочих дней — условие заказчика, принимается как написано"
  );
  assert.equal(checkText({ check: "", numbers: [], evidence: [] }), "");
});
