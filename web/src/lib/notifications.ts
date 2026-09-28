import { daysText, dueLine } from "@/lib/deadline";
import { titleOf, type Purchase } from "@/lib/purchase";
import { stepsOf, type Tone } from "@/lib/steps";

// Уведомления в колокольчике шапки: до подачи неделя и меньше, приём заявок закончился. Считаются из закупок
// в этом браузере, пока открыт сервис: сервер ничего не хранит, писем и push-уведомлений нет.
// Ответы юриста появятся вместе с разделом «Вопросы юристу» — это решение владельца.
export type Notice = {
  key: string;
  href: string;
  tone: Tone;
  title: string;
  text: string;
  sub: string;
  unread: boolean;
};

// Напоминание о сроке снова становится новым, когда до подачи остаётся неделя, 3 дня, день и в день подачи.
// В ключе — дата подачи: заказчик перенёс срок — напоминание придёт заново.
const STAGES = [0, 1, 3, 7];
// Конец приёма виден неделю, дальше закупка — только на этапе «Приём закончился» на главной.
export const ENDED_SHOWN_DAYS = 7;

// Порядок — как у закупок: по срочности (use-purchases.ts сортирует список).
export function noticesOf(purchases: Purchase[], seen: ReadonlySet<string>): Notice[] {
  const notices: Notice[] = [];
  for (const p of purchases) {
    const due = dueLine(p.deadline, true);
    if (!due) continue;
    const add = (key: string, tone: Tone, title: string, text: string, when: string) =>
      notices.push({ key, href: `/p/${p.id}`, tone, title, text, sub: when ? `${titleOf(p)} · ${when}` : titleOf(p), unread: !seen.has(key) });

    if (due.days >= 0 && due.tone === "soon") {
      const [, tp] = stepsOf(p);
      add(
        `due:${p.id}:${p.deadline.date}:${STAGES.find((s) => due.days <= s)}`,
        "warn",
        due.days === 0 ? "Подать сегодня" : `До подачи ${daysText(due.days)}`,
        tp.state === "todo" ? "ТП ещё не составлено" : tp.state === "fix" ? `В ТП осталось: ${tp.status}` : "",
        // «до 30 сентября, 10:00 МСК»; в день подачи — только время, если оно известно.
        due.head.replace(due.days === 0 ? /^Подать сегодня,? ?/ : /^Подать /, "")
      );
    } else if (due.days < 0 && due.days >= -ENDED_SHOWN_DAYS) {
      add(`end:${p.id}:${p.deadline.date}`, "calm", "Приём заявок закончился", "", due.head.replace(/^Приём заявок закончился /, ""));
    }
  }
  return notices;
}

// Что уже прочитано — ключи уведомлений в хранилище браузера. Недоступно хранилище — помним, пока открыта страница.
export const SEEN_KEY = "tl_seen_notices";
const CHANGED = "tl-seen-notices";
type Store = Pick<Storage, "getItem" | "setItem">;
let memory: string | null = null;

const browserStore = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function readSeen(store: Store | null = browserStore()): string {
  if (memory !== null) return memory;
  try {
    return store?.getItem(SEEN_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export function parseSeen(raw: string): Set<string> {
  try {
    const list: unknown = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

// Отметить прочитанными. Храним только ключи из текущего списка: прошедшие напоминания не копятся.
export function markSeen(keys: string[], notices: Notice[], store: Store | null = browserStore()) {
  const seen = parseSeen(readSeen(store));
  for (const key of keys) seen.add(key);
  const raw = JSON.stringify(notices.map((n) => n.key).filter((key) => seen.has(key)));
  try {
    if (!store) throw new Error("нет хранилища");
    store.setItem(SEEN_KEY, raw);
    memory = null;
  } catch {
    memory = raw;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

// Прочитали в другой вкладке — эта узнает из события storage, в этой же — из своего события.
export function subscribeSeen(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

// Для тестов: забыть отметки этой страницы.
export function forgetSeenMemory() {
  memory = null;
}
