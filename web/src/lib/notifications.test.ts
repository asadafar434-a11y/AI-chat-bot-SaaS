// Колокольчик: напоминания о сроке подачи, конец приёма заявок, отметки «прочитано» — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { forgetSeenMemory, markSeen, noticesOf, parseSeen, readSeen, SEEN_KEY } from "./notifications.ts";
import type { Purchase } from "./purchase.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM, type TpResult } from "./tp.ts";

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function dayAfter(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

// Дата подачи через n дней — в том же виде, в каком её выписывает модель.
function inDays(n: number) {
  const d = dayAfter(n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// «до 30 сентября, 10:00 МСК» — как в шапке закупки, без слова «Подать».
function until(n: number) {
  const d = dayAfter(n);
  const year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  return `до ${d.getDate()} ${MONTHS[d.getMonth()]}${year}, 10:00 МСК`;
}

const tp = (offer: string): TpResult => ({
  form: PLAIN_FORM,
  goods: [],
  items: [{ clause: "1", topic: "Звук", requirement: "Звукорежиссёр", quote: "звукорежиссёр", offer, verified: true }],
  antiDumping: NO_ANTI_DUMPING,
});

function purchase(id: string, days: number | null, over: Partial<Purchase> = {}): Purchase {
  return {
    id,
    createdAt: "2026-09-24T10:00:00.000Z",
    short: `Закупка ${id}`,
    subject: "",
    kind: "44-ФЗ · открытый конкурс",
    customer: "Школа № 1",
    price: "",
    deadline: { date: days === null ? "" : inDays(days), time: "10:00", zone: "МСК" },
    files: [],
    unreadable: [],
    requirements: { who: [], submit: [], scope: [], terms: [] },
    ...over,
  };
}

const NONE = new Set<string>();

test("до подачи неделя и меньше — напоминание с тем, что осталось в заявке; дальше и без даты — нет", () => {
  const list = [
    purchase("a", 0),
    purchase("b", 3, { tp: tp("Обеспечим [ФИО]") }),
    purchase("c", 7, { tp: tp("Готово") }),
    purchase("d", 8),
    purchase("e", null),
  ];
  assert.deepEqual(
    noticesOf(list, NONE).map((n) => [n.href, n.tone, n.title, n.text, n.sub, n.unread]),
    [
      ["/p/a", "warn", "Подать сегодня", "Документы заявки ещё не составлены", "Закупка a · до 10:00 МСК", true],
      ["/p/b", "warn", "До подачи 3 дня", "В заявке осталось: впишите 1 поле", `Закупка b · ${until(3)}`, true],
      ["/p/c", "warn", "До подачи 7 дней", "", `Закупка c · ${until(7)}`, true],
    ]
  );
  const noTime = purchase("a", 0, { deadline: { date: inDays(0), time: "", zone: "" } });
  assert.equal(noticesOf([noTime], NONE)[0].sub, "Закупка a", "в день подачи без времени — только название");
});

test("приём закончился — неделю, потом уведомление уходит", () => {
  const notices = noticesOf([purchase("old", -3), purchase("older", -8)], NONE);
  assert.deepEqual(notices.map((n) => [n.href, n.tone, n.title, n.text]), [["/p/old", "calm", "Приём заявок закончился", ""]]);
  const d = dayAfter(-3);
  assert.equal(notices[0].sub, `Закупка old · ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ""}`);
});

test("напоминание снова новое за неделю, за 3 дня, за день и в день подачи; перенесли срок — тоже", () => {
  const key = (days: number) => noticesOf([purchase("a", days)], NONE)[0].key;
  const stage = (days: number) => key(days).split(":").pop();
  assert.deepEqual([7, 6, 5, 4, 3, 2, 1, 0].map(stage), ["7", "7", "7", "7", "3", "3", "1", "0"]);
  assert.ok(key(5).includes(inDays(5)), "в ключе — дата подачи");

  const [notice] = noticesOf([purchase("a", 5)], NONE);
  assert.equal(noticesOf([purchase("a", 5)], new Set([notice.key]))[0].unread, false);
  assert.equal(noticesOf([purchase("a", 3)], new Set([notice.key]))[0].unread, true, "3 дня до подачи — новое");
});

test("отметки хранятся только для текущих уведомлений; кривая запись — ничего не прочитано", () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  const notices = noticesOf([purchase("a", 2), purchase("b", -1)], NONE);

  data.set(SEEN_KEY, JSON.stringify(["due:прошлое:2026-01-01:0"]));
  markSeen([notices[0].key], notices, store);
  assert.deepEqual(JSON.parse(data.get(SEEN_KEY)!), [notices[0].key], "старый ключ выброшен, новый записан");
  markSeen(notices.map((n) => n.key), notices, store);
  assert.deepEqual([...parseSeen(readSeen(store))], notices.map((n) => n.key));

  assert.equal(parseSeen("не json").size, 0);
  assert.equal(parseSeen('{"a":1}').size, 0);
  assert.deepEqual([...parseSeen('["a", 1, null]')], ["a"]);
});

test("хранилище не записывает — отметки помнятся, пока открыта страница", () => {
  const broken = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  const notices = noticesOf([purchase("a", 2)], NONE);
  markSeen([notices[0].key], notices, broken);
  assert.deepEqual([...parseSeen(readSeen(broken))], [notices[0].key]);
  forgetSeenMemory();
  assert.equal(parseSeen(readSeen(broken)).size, 0);
});
