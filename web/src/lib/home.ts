import { checkCounts } from "@/lib/check";
import { daysText, dueLine } from "@/lib/deadline";
import { plural } from "@/lib/plural";
import type { Purchase } from "@/lib/purchase";
import { reviewGaps, stepsOf, type Tone } from "@/lib/steps";

// Главная — рабочий стол, а не всё сразу: сверху одно самое срочное дело с главной кнопкой экрана, ниже — закупки
// по этапам, в конце — данные компании. Здесь — что показать, вид — в app/page.tsx.

// Бейдж статуса: пилюля с бледной заливкой статуса, текст и иконка — его цветом (components/badge.tsx).
export type BadgeIcon = "check" | "pen" | "alert" | "clock";
export type BadgeInfo = { tone: Tone; text: string; icon?: BadgeIcon };

// Дело — куда оно ведёт: шаг закупки. Порядок шагов — в steps.ts: Загрузка → Анализ → Цена → Проверка → Пакет.
export type TaskGo = "analysis" | "price" | "compose" | "review" | "package";
export type Task = { key: string; purchase: Purchase; go: TaskGo; href: string; text: string; tone: Tone };

export const GO_LABEL: Record<TaskGo, string> = {
  analysis: "Открыть анализ",
  price: "Выбрать цену",
  compose: "Составить документы",
  review: "Открыть проверку",
  package: "Открыть пакет",
};

const count = (n: number, one: string, few: string, many: string) => `${n} ${plural(n, one, few, many)}`;

// Что осталось сделать по закупкам, где ещё идёт приём. Порядок — как у закупок: по сроку подачи.
// Реквизиты — не дело: их вписывают один раз, об этом говорит остров «Данные компании».
export function tasksOf(purchases: Purchase[], scans: Record<string, string[]>): Task[] {
  const tasks: Task[] = [];
  for (const p of purchases) {
    const due = dueLine(p.deadline, false);
    if (!due || due.days < 0) continue;
    const urgent: Tone = due.tone === "soon" ? "warn" : "brand";
    const [, analysis, price, review, pack] = stepsOf(p);
    const add = (go: TaskGo, href: string, text: string, tone: Tone) =>
      tasks.push({ key: `${p.id}:${tasks.length}`, purchase: p, go, href, text, tone });
    const bad = p.check ? checkCounts(p.check).bad : 0;
    const gaps = reviewGaps(p);
    if (bad) add("review", review.href, bad === 1 ? "Исправить ошибку в заявке" : `Исправить ошибки в заявке — ${bad}`, "bad");
    else if (!p.tp) add("compose", review.href, "Составить документы заявки", urgent);
    else if (gaps.invalid) add("review", review.href, `Исправить данные в заявке — ${count(gaps.invalid, "поле", "поля", "полей")}`, "bad");
    else if (gaps.empty) add("review", review.href, `Вписать свои данные в заявку — ${count(gaps.empty, "поле", "поля", "полей")}`, urgent);
    else if (gaps.price) add("price", price.href, "Поставить цену в заявку", urgent);
    else add("package", pack.href, "Скачать документы и подать заявку на площадке", urgent);
    const scanned = scans[p.id] ?? [];
    if (scanned.length) add("analysis", analysis.href, `Сверить цифры в ${scanned.length === 1 ? "файле со скана" : "файлах со скана"}`, "warn");
    for (const f of p.unreadable) add("analysis", analysis.href, `Пересохранить «${f.name}» — файл не прочитан`, "warn");
  }
  return tasks;
}

// Этапы — как колонки доски у Контур.Закупок и этапы у Тендерплана, но по нашему пути: составить документы,
// дописать данные, подать. Этап не двигают руками: он следует из шага «Проверка» и срока подачи.
export type LaneKey = "compose" | "fill" | "ready" | "closed";

export const LANES: { key: LaneKey; title: string }[] = [
  { key: "compose", title: "Составить документы" },
  { key: "fill", title: "Дописать данные" },
  { key: "ready", title: "Готово к подаче" },
  { key: "closed", title: "Приём закончился" },
];

export function laneOf(p: Purchase): LaneKey {
  const due = dueLine(p.deadline, false);
  if (due && due.days < 0) return "closed";
  if (!p.tp) return "compose";
  return stepsOf(p)[3].state === "done" ? "ready" : "fill";
}

// Что на этапе ждёт вас — одной строкой под числом.
export function laneNote(key: LaneKey, list: Purchase[]): { tone: Tone; text: string } {
  if (!list.length) return { tone: "calm", text: "нет закупок" };
  if (key === "compose") return { tone: "brand", text: "составить документы" };
  if (key === "fill") {
    const bad = list.filter((p) => stepsOf(p)[3].tone === "bad").length;
    return bad
      ? { tone: "bad", text: `${bad} с ошибками` }
      : { tone: "warn", text: `${list.length} ${plural(list.length, "ждёт", "ждут", "ждут")} ваших данных` };
  }
  if (key === "ready") return { tone: "ok", text: "можно подавать" };
  return { tone: "calm", text: "срок прошёл" };
}

// Что с закупкой сейчас — коротко, бейджем: в таблице на главной и в списке закупок.
export function stageBadge(p: Purchase): BadgeInfo {
  const due = dueLine(p.deadline, false);
  if (due && due.days < 0) return { tone: "calm", text: "приём закончился" };
  if (!p.tp) return { tone: "brand", text: "составить документы" };
  const review = stepsOf(p)[3];
  if (review.state === "done") return { tone: "ok", text: "готово к подаче", icon: "check" };
  return review.tone === "bad" ? { tone: "bad", text: review.status, icon: "alert" } : { tone: "warn", text: review.status, icon: "pen" };
}

// Срок подачи бейджем: янтарный — неделя и меньше, серый — дальше или уже прошёл. long — «5 дней до подачи».
export function dueBadge(p: Purchase, long = false): BadgeInfo {
  const due = dueLine(p.deadline, false);
  if (!due) return { tone: "calm", text: "срок не найден" };
  if (due.days < 0) return { tone: "calm", text: due.head.replace(/^Приём заявок закончился /, "") };
  const text = due.days === 0 ? "подать сегодня" : long ? `${daysText(due.days)} до подачи` : daysText(due.days);
  return { tone: due.tone === "soon" ? "warn" : "calm", text, icon: "clock" };
}
