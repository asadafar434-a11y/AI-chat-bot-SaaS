// Срок подачи заявок: обратный отсчёт и порядок закупок в списке — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { byUrgency, dueLine } from "./deadline.ts";

// Дата через n дней от сегодня — как её пишет разбор документов: ГГГГ-ММ-ДД по местному времени.
function inDays(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const on = (date: string, time = "", zone = "") => ({ date, time, zone });

test("отсчёт до срока: склонение дней, янтарный за неделю до срока", () => {
  const cases: [number, string, "soon" | "calm"][] = [
    [1, "1\u00a0день", "soon"],
    [3, "3\u00a0дня", "soon"],
    [7, "7\u00a0дней", "soon"],
    [8, "8\u00a0дней", "calm"],
    [11, "11\u00a0дней", "calm"],
    [21, "21\u00a0день", "calm"],
    [22, "22\u00a0дня", "calm"],
  ];
  for (const [n, left, tone] of cases) {
    const due = dueLine(on(inDays(n)), false)!;
    assert.equal(due.days, n);
    assert.equal(due.left, `осталось\u00a0${left}`);
    assert.equal(due.tone, tone, `${n} дн.`);
    assert.match(due.head, /^Подать до \d{1,2} [а-я]+( \d{4})?$/);
    assert.equal(due.text, `${due.head} · ${due.left}`);
  }
});

test("время и пояс — только на экране закупки", () => {
  const date = inDays(10);
  assert.match(dueLine(on(date, "10:00", "МСК"), true)!.head, /, 10:00 МСК$/);
  assert.match(dueLine(on(date, "10:00", ""), true)!.head, /, 10:00$/);
  assert.doesNotMatch(dueLine(on(date, "10:00", "МСК"), false)!.head, /10:00/);
  // Без времени пояс не показываем: «до МСК» ничего не говорит.
  assert.doesNotMatch(dueLine(on(date, "", "МСК"), true)!.head, /МСК/);
});

test("срок сегодня и прошедший срок", () => {
  const today = dueLine(on(inDays(0), "09:00", "МСК+4"), true)!;
  assert.deepEqual([today.head, today.tone, today.days, today.left], ["Подать сегодня, до 09:00 МСК+4", "soon", 0, undefined]);
  assert.equal(dueLine(on(inDays(0)), false)!.head, "Подать сегодня");

  const past = dueLine(on(inDays(-2)), false)!;
  assert.equal(past.tone, "past");
  assert.equal(past.days, -2);
  assert.equal(past.left, undefined);
  assert.match(past.head, /^Приём заявок закончился \d{1,2} [а-я]+/);
});

test("год пишется, только если он не текущий", () => {
  const now = new Date();
  const year = now.getFullYear();
  // Месяц — не текущий, чтобы дата не пришлась на сегодня.
  const [mm, month] = now.getMonth() === 2 ? ["09", "сентября"] : ["03", "марта"];
  assert.equal(dueLine(on(`${year + 1}-${mm}-10`), false)!.head, `Подать до 10 ${month} ${year + 1}`);
  // Та же дата в текущем году — без года, будь она впереди или уже прошла.
  assert.match(dueLine(on(`${year}-${mm}-10`), false)!.head, new RegExp(` 10 ${month}$`));
});

test("неверная или пустая дата — срока нет, а не «Invalid Date»", () => {
  for (const date of ["", "  ", "2026-02-30", "2026-13-01", "30.09.2026", "2026-9-30", "завтра"]) {
    assert.equal(dueLine(on(date), true), null, JSON.stringify(date));
  }
  // Пробелы по краям разбор документов иногда оставляет — дата от этого не пропадает.
  assert.equal(dueLine(on(` ${inDays(5)} `), false)!.days, 5);
});

test("порядок в списке: сначала ближайший срок, потом без срока, в конце прошедшие — свежие выше", () => {
  const list = [
    { id: "прошла давно", ...on(inDays(-30)) },
    { id: "без срока", ...on("") },
    { id: "через 20 дней", ...on(inDays(20)) },
    { id: "вчера", ...on(inDays(-1)) },
    { id: "сегодня", ...on(inDays(0)) },
    { id: "через 2 дня", ...on(inDays(2)) },
  ];
  assert.deepEqual(
    list.sort(byUrgency).map((p) => p.id),
    ["сегодня", "через 2 дня", "через 20 дней", "без срока", "вчера", "прошла давно"]
  );
});
