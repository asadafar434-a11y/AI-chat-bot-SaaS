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
      ["a", "Составить документы заявки", "warn", "compose", "/p/a/check"],
      ["b", "Вписать свои данные в заявку — 1 поле", "brand", "review", "/p/b/check"],
      ["c", "Скачать документы и подать заявку на площадке", "brand", "package", "/p/c/package"],
      ["d", "Исправить ошибки в заявке — 2", "bad", "review", "/p/d/check"],
      ["e", "Скачать документы и подать заявку на площадке", "brand", "package", "/p/e/package"],
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
      ["Составить документы заявки", "compose"],
      ["Сверить цифры в файле со скана", "analysis"],
      ["Пересохранить «Проект контракта.pdf» — файл не прочитан", "analysis"],
    ]
  );
  assert.equal(new Set(tasks.map((t) => t.key)).size, tasks.length, "ключи дел не повторяются");
});

test("форма заказчика с ценой, а цена не поставлена — дело на шаге «Цена»", () => {
  const p = purchase("f", 5, { tp: { ...tp("Готово"), form: { ...PLAIN_FORM, hasPrice: true } } });
  assert.deepEqual(
    tasksOf([p], {}).map((t) => [t.text, t.go, t.href]),
    [["Поставить цену в заявку", "price", "/p/f/price"]]
  );
});

test("этап следует из шага «Проверка» и срока подачи", () => {
  assert.equal(laneOf(purchase("a", 5)), "compose");
  assert.equal(laneOf(purchase("a", 5, { tp: tp("[ИНН]") })), "fill");
  assert.equal(laneOf(purchase("a", 5, { tp: tp("Готово") })), "ready");
  // Замечания к своей заявке не держат этап, ошибки — держат.
  assert.equal(laneOf(purchase("a", 5, { tp: tp("Готово"), check: check("warn") })), "ready");
  assert.equal(laneOf(purchase("a", 5, { tp: tp("Готово"), check: check("bad") })), "fill");
  assert.equal(laneOf(purchase("a", -3, { tp: tp("Готово"), check: check() })), "closed");
  assert.equal(laneOf(purchase("a", null)), "compose");
});

test("что ждёт на этапе — одной строкой", () => {
  assert.deepEqual(laneNote("compose", []), { tone: "calm", text: "нет закупок" });
  assert.deepEqual(laneNote("compose", [purchase("a", 5)]), { tone: "brand", text: "составить документы" });
  assert.deepEqual(laneNote("fill", [purchase("a", 5, { tp: tp("[ИНН]") }), purchase("b", 5, { tp: tp("[КПП]") })]), { tone: "warn", text: "2 ждут ваших данных" });
  assert.deepEqual(laneNote("fill", [purchase("a", 5, { tp: tp("Готово"), check: check("bad") })]), { tone: "bad", text: "1 с ошибками" });
  assert.deepEqual(laneNote("ready", [purchase("a", 5)]), { tone: "ok", text: "можно подавать" });
});

test("бейджи этапа и срока", () => {
  assert.deepEqual(stageBadge(purchase("a", 5)), { tone: "brand", text: "составить документы" });
  assert.deepEqual(stageBadge(purchase("a", 5, { tp: tp("[ИНН]", "[КПП]") })), { tone: "warn", text: "впишите 2 поля", icon: "pen" });
  assert.deepEqual(stageBadge(purchase("a", 5, { tp: tp("Готово"), check: check("bad") })), { tone: "bad", text: "1 ошибка", icon: "alert" });
  assert.deepEqual(stageBadge(purchase("a", 5, { tp: tp("Готово"), check: check() })), { tone: "ok", text: "готово к подаче", icon: "check" });
  assert.deepEqual(stageBadge(purchase("a", -1)), { tone: "calm", text: "приём закончился" });

  assert.deepEqual(dueBadge(purchase("a", 0)), { tone: "warn", text: "подать сегодня", icon: "clock" });
  assert.deepEqual(dueBadge(purchase("a", 3), true), { tone: "warn", text: "3 дня до подачи", icon: "clock" });
  assert.deepEqual(dueBadge(purchase("a", 21)), { tone: "calm", text: "21 день", icon: "clock" });
  assert.deepEqual(dueBadge(purchase("a", null)), { tone: "calm", text: "срок не найден" });
  assert.doesNotMatch(dueBadge(purchase("a", -2)).text, /Приём заявок/);
});
