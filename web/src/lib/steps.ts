import { checkCounts } from "@/lib/check";
import { dueLine } from "@/lib/deadline";
import { plural } from "@/lib/plural";
import type { Purchase } from "@/lib/purchase";
import { REQ_GROUP_KEYS } from "@/lib/requirements";
import { fillCount } from "@/lib/tp";

// Подготовка заявки по закупке — три шага по порядку: разобраться в требованиях, подготовить
// техническое предложение, проверить заявку. Потом участник подаёт её на электронной площадке.
export type StepKey = "req" | "tp" | "check";
export type StepState = "done" | "fix" | "todo";
export type Tone = "ok" | "warn" | "bad" | "brand" | "calm";

export type Step = {
  key: StepKey;
  n: number;
  title: string;
  short: string;
  href: string;
  state: StepState;
  status: string;
  tone: Tone;
};

const count = (n: number, one: string, few: string, many: string) => `${n} ${plural(n, one, few, many)}`;

export function stepsOf(p: Purchase): Step[] {
  const base = `/p/${p.id}`;
  const reqs = REQ_GROUP_KEYS.reduce((n, key) => n + p.requirements[key].length, 0);
  const fill = p.tp ? fillCount(p.tp) : 0;
  const checked = p.check ? checkCounts(p.check) : null;

  const req: Step = {
    key: "req",
    n: 1,
    title: "Требования",
    short: "Требования",
    href: base,
    state: "done",
    status: reqs ? `выписаны: ${count(reqs, "пункт", "пункта", "пунктов")}` : "не нашлись в документах",
    tone: reqs ? "calm" : "warn",
  };

  const tp: Step = {
    key: "tp",
    n: 2,
    title: "Техническое предложение",
    short: "ТП",
    href: `${base}/tp`,
    ...(!p.tp
      ? { state: "todo" as const, status: "не составлено", tone: "calm" as const }
      : fill
        ? { state: "fix" as const, status: `впишите ${count(fill, "пункт", "пункта", "пунктов")}`, tone: "warn" as const }
        : { state: "done" as const, status: "готово", tone: "ok" as const }),
  };

  const check: Step = {
    key: "check",
    n: 3,
    title: "Проверка заявки",
    short: "Проверка",
    href: `${base}/check`,
    ...(!checked
      ? { state: "todo" as const, status: "не проверена", tone: "calm" as const }
      : checked.bad
        ? { state: "fix" as const, status: count(checked.bad, "ошибка", "ошибки", "ошибок"), tone: "bad" as const }
        : checked.warn
          ? { state: "fix" as const, status: count(checked.warn, "замечание", "замечания", "замечаний"), tone: "warn" as const }
          : { state: "done" as const, status: "ошибок нет", tone: "ok" as const }),
  };

  return [req, tp, check];
}

// Где закупка сейчас — одной строкой для списков: какой шаг и что на нём сделать.
export function stageOf(p: Purchase): { text: string; tone: Tone; href: string } {
  const [, tp, check] = stepsOf(p);
  const due = dueLine(p.deadline, false);
  if (due && due.days < 0) return { text: "Приём заявок закончился", tone: "calm", href: `/p/${p.id}` };
  if (p.check) {
    if (check.state === "done") return { text: "Готово к подаче на площадке", tone: "ok", href: check.href };
    return { text: `Шаг 3 · проверка: ${check.status}`, tone: check.tone, href: check.href };
  }
  if (tp.state === "todo") return { text: "Шаг 2 · составить ТП", tone: "brand", href: tp.href };
  if (tp.state === "fix") return { text: `Шаг 2 · ТП: ${tp.status}`, tone: "warn", href: tp.href };
  return { text: "Шаг 3 · проверить заявку", tone: "brand", href: check.href };
}

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-[var(--ok)]",
  warn: "text-[var(--warn)]",
  bad: "text-destructive",
  brand: "text-primary",
  calm: "text-[var(--ink-3)]",
};
