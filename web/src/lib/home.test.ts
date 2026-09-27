// Главная: дела «Сейчас важно», этапы закупок, бейджи этапа и срока — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CheckResult } from "./check.ts";
import { dueBadge, laneNote, laneOf, stageBadge, tasksOf } from "./home.ts";
import type { Purchase } from "./purchase.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM, type TpItem, type TpResult } from "./tp.ts";

// Дата подачи через n дней — в том же виде, в каком её выписывает модель.
function inDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const item = (offer: string): TpItem => ({ clause: "1", topic: "Звук", requirement: "Звукорежиссёр", quote: "звукорежиссёр", offer, verified: true });
const tp = (...offers: string[]): TpResult => ({ form: PLAIN_FORM, goods: [], items: offers.map(item), antiDumping: NO_ANTI_DUMPING });
const check = (...kinds: ("bad" | "warn")[]) =>
  ({ findings: kinds.map((kind) => ({ kind, text: "", source: "", quote: "" })), files: [], docsKey: "", checkedAt: "" }) as unknown as CheckResult;

function purchase(id: string, days: number | null, over: Partial<Purchase> = {}): Purchase {
  return {
    id,
    createdAt: "2026-09-24T10:00:00.000Z",
    short: `Закупка ${id}`,
    subject: "",
    kind: "44-ФЗ · открытый конкурс",
    customer: "Школа № 1",
    price: "",
    deadline: { date: days === null ? "" : inDays(days), time: "", zone: "" },
    files: [],
    unreadable: [],
    requirements: { who: [], submit: [], scope: [], terms: [] },
    ...over,
  };
}

test("дела — по шагам заявки, со сроком и цветом", () => {
  const list = [
    purchase("a", 2),
    purchase("b", 10, { tp: tp("Обеспечим звукорежиссёра [ФИО, стаж]") }),
    purchase("c", 12, { tp: tp("Обеспечим звукорежиссёра") }),
    purchase("d", 14, { tp: tp("Готово"), check: check("bad", "bad") }),
    purchase("e", 20, { tp: tp("Готово"), check: check() }),
  ];
  assert.deepEqual(
    tasksOf(list, {}).map((t) => [t.purchase.id, t.text, t.tone, t.go, t.href]),
    [
      ["a", "Составить техническое предложение", "warn", "tp", "/p/a/tp"],
      ["b", "Вписать свои данные в ТП — 1 пункт", "brand", "tp", "/p/b/tp"],
      ["c", "Проверить заявку перед подачей", "brand", "check", "/p/c/check"],
      ["d", "Исправить ошибки в заявке — 2", "bad", "check", "/p/d/check"],
      ["e", "Скачать документы и подать заявку на площадке", "brand", "files", "/p/e/tp"],
    ]
  );
});

test("сканы и непрочитанные файлы — отдельными делами; прошедший срок и срок без даты — без дел", () => {
  const list = [
    purchase("a", 3, { unreadable: [{ name: "Проект контракта.pdf", reason: "" }] }),
    purchase("old", -1),
    purchase("none", null),
  ];
  const tasks = tasksOf(list, { a: ["ТЗ.pdf"], old: ["ТЗ.pdf"] });
  assert.deepEqual(
    tasks.map((t) => [t.text, t.go]),
    [
      ["Составить техническое предложение", "tp"],
      ["Сверить цифры в файле со скана", "req"],
      ["Пересохранить «Проект контракта.pdf» — файл не прочитан", "req"],
    ]
  );
  assert.equal(new Set(tasks.map((t) => t.key)).size, tasks.length, "ключи дел не повторяются");
});

test("этап следует из шагов и срока подачи", () => {
  assert.equal(laneOf(purchase("a", 5)), "tp");
  assert.equal(laneOf(purchase("a", 5, { tp: tp("[ИНН]") })), "tp");
  assert.equal(laneOf(purchase("a", 5, { tp: tp("Готово") })), "check");
  assert.equal(laneOf(purchase("a", 5, { tp: tp("Готово"), check: check("warn") })), "check");
  assert.equal(laneOf(purchase("a", 5, { tp: tp("Готово"), check: check() })), "ready");
  assert.equal(laneOf(purchase("a", -3, { tp: tp("Готово"), check: check() })), "closed");
  assert.equal(laneOf(purchase("a", null)), "tp");
});

test("что ждёт на этапе — одной строкой", () => {
  assert.deepEqual(laneNote("tp", []), { tone: "calm", text: "нет закупок" });
  assert.deepEqual(laneNote("tp", [purchase("a", 5)]), { tone: "brand", text: "составить ТП" });
  assert.deepEqual(laneNote("tp", [purchase("a", 5, { tp: tp("[ИНН]") }), purchase("b", 5, { tp: tp("[КПП]") })]), { tone: "warn", text: "2 ждут ваших данных" });
  assert.deepEqual(laneNote("check", [purchase("a", 5, { tp: tp("Готово"), check: check("bad") })]), { tone: "bad", text: "1 с ошибками" });
  assert.deepEqual(laneNote("check", [purchase("a", 5, { tp: tp("Готово") })]), { tone: "brand", text: "проверить перед подачей" });
  assert.deepEqual(laneNote("ready", [purchase("a", 5)]), { tone: "ok", text: "можно подавать" });
});

test("бейджи этапа и срока", () => {
  assert.deepEqual(stageBadge(purchase("a", 5)), { tone: "brand", text: "составить ТП" });
  assert.deepEqual(stageBadge(purchase("a", 5, { tp: tp("[ИНН]", "[КПП]") })), { tone: "warn", text: "ТП: впишите 2 пункта", icon: "pen" });
  assert.deepEqual(stageBadge(purchase("a", 5, { tp: tp("Готово"), check: check("bad") })), { tone: "bad", text: "1 ошибка", icon: "alert" });
  assert.deepEqual(stageBadge(purchase("a", 5, { tp: tp("Готово"), check: check() })), { tone: "ok", text: "готово к подаче", icon: "check" });
  assert.deepEqual(stageBadge(purchase("a", -1)), { tone: "calm", text: "приём закончился" });

  assert.deepEqual(dueBadge(purchase("a", 0)), { tone: "warn", text: "подать сегодня", icon: "clock" });
  assert.deepEqual(dueBadge(purchase("a", 3), true), { tone: "warn", text: "3 дня до подачи", icon: "clock" });
  assert.deepEqual(dueBadge(purchase("a", 21)), { tone: "calm", text: "21 день", icon: "clock" });
  assert.deepEqual(dueBadge(purchase("a", null)), { tone: "calm", text: "срок не найден" });
  assert.doesNotMatch(dueBadge(purchase("a", -2)).text, /Приём заявок/);
});
