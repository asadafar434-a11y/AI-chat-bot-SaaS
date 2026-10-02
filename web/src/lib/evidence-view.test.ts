// Слова про факты базы доказательств для экрана — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFact, type FactInput } from "./evidence-base.ts";
import { evidenceSummary, factLines, gapFrom, gapPurchases, sourceLine, STATUS_HINT, STATUS_TONE, validityBadge } from "./evidence-view.ts";

const NOW = new Date("2026-10-01T10:00:00Z");
const fact = (input: FactInput, id = "f") => makeFact(input, NOW, id);
const ON = "2026-10-01";

test("бейдж срока: цвет по состоянию; у факта без срока и без обязательности бейджа нет", () => {
  const badge = (input: FactInput) => validityBadge(fact(input), ON);
  assert.deepEqual(badge({ kind: "license", title: "Л", validity: { until: "2027-05-12" } }), { text: "действует до 12.05.2027", tone: "success" });
  assert.deepEqual(badge({ kind: "license", title: "Л", validity: { until: "2026-10-11" } }), { text: "истекает через 10 дней (11.10.2026)", tone: "warn" });
  assert.deepEqual(badge({ kind: "license", title: "Л", validity: { until: "2026-09-01" } }), { text: "просрочено: действовало до 01.09.2026", tone: "danger" });
  assert.deepEqual(badge({ kind: "license", title: "Л", validity: { perpetual: true } }), { text: "бессрочно", tone: "success" });
  assert.deepEqual(badge({ kind: "license", title: "Л" }), { text: "срок не указан", tone: "warn" }, "у лицензии срок обязателен");
  assert.deepEqual(badge({ kind: "license", title: "Л", validity: { from: "2027-01-01", until: "2028-01-01" } }), { text: "начнёт действовать 01.01.2027", tone: "warn" });
  assert.equal(badge({ kind: "employee", title: "Иванов И. И." }), null);
  assert.equal(badge({ kind: "experience", title: "Договор" }), null);
  assert.equal(badge({ kind: "document", title: "Устав" }), null, "у устава срок необязателен");
});

test("строки факта: поля с подписями, даты по-русски, числа с единицами; пустое не показывается", () => {
  const f = fact({
    kind: "experience",
    title: "Договор",
    fields: { customer: "Управление образования", contractNo: "45", contractDate: "2026-06-10", actDate: "2026-06-25", subject: "  " },
    measures: [{ what: "цена договора", value: 1200000, unit: "руб." }],
  });
  assert.deepEqual(factLines(f), [
    "Заказчик: Управление образования",
    "Номер договора: 45",
    "Дата договора: 10.06.2026",
    "Дата акта: 25.06.2026",
    `цена договора: ${(1200000).toLocaleString("ru-RU")} руб.`,
  ]);
  assert.deepEqual(factLines(fact({ kind: "finance", title: "Выручка" })), []);
});

test("источник: документ с местом и цитатой — или «вписано вручную», без документа", () => {
  assert.equal(sourceLine(fact({ kind: "license", title: "Л" })), "вписано вручную — документа нет");
  assert.equal(sourceLine(fact({ kind: "license", title: "Л", source: { type: "manual", note: "со слов директора" } })), "вписано вручную: со слов директора");
  assert.equal(
    sourceLine(fact({ kind: "license", title: "Л", source: { type: "document", docId: "d", docName: "Лицензия.pdf", quote: "Лицензия действительна до 12.05.2027", where: "стр. 1" } })),
    "из «Лицензия.pdf» — стр. 1: «Лицензия действительна до 12.05.2027»"
  );
  assert.equal(sourceLine(fact({ kind: "license", title: "Л", source: { type: "document", docId: "d", docName: "Лицензия.pdf", quote: "" } })), "из «Лицензия.pdf»");
  assert.match(sourceLine(fact({ kind: "license", title: "Л", source: { type: "document", docId: "d", docName: "Л.pdf", quote: "а".repeat(300) } })), /…»$/);
});

test("статусы проверки: у каждого свой цвет и подсказка; «решает человек» — индиго, «нет доказательства» — янтарь", () => {
  assert.deepEqual(STATUS_TONE, { ok: "success", expiring: "warn", expired: "danger", mismatch: "danger", needs_evidence: "warn", need_human: "info" });
  for (const status of Object.keys(STATUS_TONE) as (keyof typeof STATUS_TONE)[]) assert.ok(STATUS_HINT[status].length > 20, status);
  assert.match(STATUS_HINT.needs_evidence, /ничего не подставляет/);
});

test("закупки, которым нужно доказательство, — словами", () => {
  const p = (...titles: string[]) => ({ purchases: titles.map((title, i) => ({ id: String(i), title })) });
  assert.equal(gapPurchases(p("Праздник")), "Закупка: «Праздник»");
  assert.equal(gapPurchases(p("А", "Б")), "Закупки: «А», «Б»");
  assert.equal(gapPurchases(p("А", "Б", "В", "Г")), "Закупки: «А», «Б» и ещё 2");
});

test("откуда потребность: требование и его вид; длинное сокращается, лишние — «и ещё N»", () => {
  const from = (...texts: string[]) => ({ from: texts.map((text, i) => ({ basis: i % 2 ? "Критерий оценки" : "Что подать", text })) });
  assert.deepEqual(gapFrom(from("Устав")), ["Что подать: «Устав»"]);
  assert.deepEqual(gapFrom(from("А", "Б", "В")), ["Что подать: «А»", "Критерий оценки: «Б»", "и ещё 1 требование"]);
  assert.deepEqual(gapFrom(from("А", "Б", "В", "Г", "Д")).at(-1), "и ещё 3 требования");
  assert.deepEqual(gapFrom(from("А", "Б", "В", "Г", "Д", "Е", "Ж"), 2).at(-1), "и ещё 5 требований");
  const [long] = gapFrom(from(`Зал ${"вместимостью ".repeat(40)}`));
  assert.ok(long.length < 190 && long.endsWith("…»"), long);
  assert.deepEqual(gapFrom(from("Зал\n   не менее\n150 мест")), ["Что подать: «Зал не менее 150 мест»"], "переносы строк — пробелами");
  assert.deepEqual(gapFrom({ from: [] }), []);
});

test("сводка базы: действуют, скоро кончатся, просрочены, без срока, ждут подтверждения", () => {
  const facts = [
    fact({ kind: "license", title: "А", validity: { until: "2027-01-01" } }, "1"),
    fact({ kind: "license", title: "Б", validity: { perpetual: true } }, "2"),
    fact({ kind: "certificate", title: "В", validity: { until: "2026-10-20" } }, "3"),
    fact({ kind: "certificate", title: "Г", validity: { until: "2026-01-01" } }, "4"),
    fact({ kind: "qualification", title: "Д" }, "5"),
    fact({ kind: "employee", title: "Е", origin: "ai" }, "6"),
    fact({ kind: "document", title: "Ж" }, "7"),
  ];
  assert.deepEqual(evidenceSummary(facts, ON), { total: 7, valid: 2, expiring: 1, expired: 1, noTerm: 1, unconfirmed: 1 });
  assert.deepEqual(evidenceSummary([], ON), { total: 0, valid: 0, expiring: 0, expired: 0, noTerm: 0, unconfirmed: 0 });
});
