// «Мои закупки»: статус, готовность, способ закупки и поиск считаются из самой закупки — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lawText, matches, nextHref, procedureOf, progressOf, statusOf } from "./dashboard.ts";
import type { Purchase } from "./purchase.ts";
import { stepsOf } from "./steps.ts";

const purchase = (over: Partial<Purchase> = {}): Purchase => ({
  id: "p1",
  createdAt: "2026-09-30T10:00:00.000Z",
  short: "Бумага",
  subject: "Поставка бумаги А4",
  kind: "44-ФЗ · электронный аукцион",
  customer: "ГБУ Тест",
  price: "100 000 ₽",
  deadline: { date: "2026-12-01", time: "10:00", zone: "МСК" },
  files: ["Извещение.pdf", "ТЗ.docx"],
  unreadable: [],
  requirements: {
    who: [],
    submit: [],
    scope: [{ text: "Плотность от 80 г/м²", source: "ТЗ", quote: "q", verified: true }],
    terms: [],
  },
  ...over,
});

test("свежая закупка — черновик: загрузка и анализ сделаны, остальное нет", () => {
  const p = purchase();
  const steps = stepsOf(p);
  assert.deepEqual(steps.map((s) => s.state), ["done", "done", "todo", "todo", "todo"]);
  assert.equal(statusOf(p, steps), "draft");
  assert.equal(progressOf(steps), 40);
});

test("выбрана цена — закупка в работе; ведёт на первый шаг, где ещё есть дело", () => {
  const p = purchase({ tpPrice: 90_000 });
  const steps = stepsOf(p);
  assert.equal(statusOf(p, steps), "progress");
  assert.equal(progressOf(steps), 60);
  assert.equal(nextHref(steps), "/p/p1/check");
});

test("цена выше начальной — шаг требует правки, закупка не готова", () => {
  const p = purchase({ tpPrice: 150_000 });
  assert.equal(stepsOf(p)[2].state, "fix");
  assert.equal(statusOf(p), "progress");
});

test("отметка «Подана» — 100 % и статус «Подана», что бы ни было в шагах", () => {
  const p = purchase({ submitted: true });
  assert.equal(statusOf(p), "submitted");
  assert.equal(progressOf(stepsOf(p), true), 100);
});

test("способ и закон берутся из строки разбора; без способа — пусто", () => {
  assert.equal(procedureOf(purchase()), "Электронный аукцион");
  assert.equal(lawText(purchase()), "44-ФЗ");
  assert.equal(procedureOf(purchase({ kind: "223-ФЗ" })), "");
  assert.equal(lawText(purchase({ kind: "" })), "");
});

test("поиск — по названию, заказчику, предмету, способу и цене; без запроса находит всё", () => {
  const p = purchase();
  assert.equal(matches(p, "Бумага", ""), true);
  assert.equal(matches(p, "Бумага", "гбу"), true);
  assert.equal(matches(p, "Бумага", "аукцион"), true);
  assert.equal(matches(p, "Бумага", "100 000"), true);
  assert.equal(matches(p, "Бумага", "картриджи"), false);
});
