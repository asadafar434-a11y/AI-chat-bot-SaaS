import { checkCounts } from "@/lib/check";
import { daysText, dueLine } from "@/lib/deadline";
import { plural } from "@/lib/plural";
import type { Purchase } from "@/lib/purchase";
import { stepsOf, type Tone } from "@/lib/steps";

// Главная — рабочий стол, а не всё сразу: сверху одно самое срочное дело с главной кнопкой экрана, ниже — закупки
// по этапам, в конце — данные компании. Здесь — что показать, вид — в app/page.tsx.

// Бейдж статуса: пилюля с бледной заливкой статуса, текст и иконка — его цветом (components/badge.tsx).
export type BadgeIcon = "check" | "pen" | "alert" | "clock";
export type BadgeInfo = { tone: Tone; text: string; icon?: BadgeIcon };

// Дело — куда оно ведёт: шаг закупки или окно «Документы заявки» (…#files открывает его в закупке).
export type TaskGo = "req" | "tp" | "check" | "files";
export type Task = { key: string; purchase: Purchase; go: TaskGo; href: string; text: string; tone: Tone };

export const GO_LABEL: Record<TaskGo, string> = {
  req: "Открыть требования",
  tp: "Открыть ТП",
  check: "Открыть проверку",
  files: "Скачать документы",
};

// Что осталось сделать по закупкам, где ещё идёт приём. Порядок — как у закупок: по сроку подачи.
// Реквизиты — не дело: их вписывают один раз, об этом говорит остров «Данные компании».
export function tasksOf(purchases: Purchase[], scans: Record<string, string[]>): Task[] {
  const tasks: Task[] = [];
  for (const p of purchases) {
    const due = dueLine(p.deadline, false);
    if (!due || due.days < 0) continue;
    const urgent: Tone = due.tone === "soon" ? "warn" : "brand";
    const [req, tp, check] = stepsOf(p);
    const add = (go: TaskGo, href: string, text: string, tone: Tone) =>
      tasks.push({ key: `${p.id}:${tasks.length}`, purchase: p, go, href, text, tone });
    const bad = p.check ? checkCounts(p.check).bad : 0;
    if (bad) add("check", check.href, bad === 1 ? "Исправить ошибку в заявке" : `Исправить ошибки в заявке — ${bad}`, "bad");
    else if (!p.check) {
      if (tp.state === "todo") add("tp", tp.href, "Составить техническое предложение", urgent);
      else if (tp.state === "fix") add("tp", tp.href, `Вписать свои данные в ТП — ${tp.status.replace(/^впишите /, "")}`, urgent);
      else add("check", check.href, "Проверить заявку перед подачей", urgent);
    } else if (check.state === "done") add("files", `${req.href}#files`, "Скачать документы и подать заявку на площадке", urgent);
    const scanned = scans[p.id] ?? [];
    if (scanned.length) add("req", req.href, `Сверить цифры в ${scanned.length === 1 ? "файле со скана" : "файлах со скана"}`, "warn");
    for (const f of p.unreadable) add("req", req.href, `Пересохранить «${f.name}» — файл не прочитан`, "warn");
  }
  return tasks;
}

// Этапы — как колонки доски у Контур.Закупок и этапы у Тендерплана, но по нашему пути из трёх шагов.
// Этап не двигают руками: он следует из шагов и срока подачи.
export type LaneKey = "tp" | "check" | "ready" | "closed";

export const LANES: { key: LaneKey; title: string }[] = [
  { key: "tp", title: "Техническое предложение" },
  { key: "check", title: "Проверка заявки" },
  { key: "ready", title: "Готово к подаче" },
  { key: "closed", title: "Приём закончился" },
];

export function laneOf(p: Purchase): LaneKey {
  const due = dueLine(p.deadline, false);
  if (due && due.days < 0) return "closed";
  const [, tp, check] = stepsOf(p);
  if (check.state === "done") return "ready";
  return p.check || tp.state === "done" ? "check" : "tp";
}

// Что на этапе ждёт вас — одной строкой под числом.
export function laneNote(key: LaneKey, list: Purchase[]): { tone: Tone; text: string } {
  if (!list.length) return { tone: "calm", text: "нет закупок" };
  if (key === "tp") {
    const fix = list.filter((p) => stepsOf(p)[1].state === "fix").length;
    return fix ? { tone: "warn", text: `${fix} ${plural(fix, "ждёт", "ждут", "ждут")} ваших данных` } : { tone: "brand", text: "составить ТП" };
  }
  if (key === "check") {
    const bad = list.filter((p) => p.check && checkCounts(p.check).bad).length;
    return bad ? { tone: "bad", text: `${bad} с ошибками` } : { tone: "brand", text: "проверить перед подачей" };
  }
  if (key === "ready") return { tone: "ok", text: "можно подавать" };
  return { tone: "calm", text: "срок прошёл" };
}

// Что с закупкой сейчас — коротко, бейджем: в таблице на главной.
export function stageBadge(p: Purchase): BadgeInfo {
  const [, tp, check] = stepsOf(p);
  const due = dueLine(p.deadline, false);
  if (due && due.days < 0) return { tone: "calm", text: "приём закончился" };
  if (p.check) {
    if (check.state === "done") return { tone: "ok", text: "готово к подаче", icon: "check" };
    return { tone: check.tone === "bad" ? "bad" : "warn", text: check.status, icon: "alert" };
  }
  if (tp.state === "todo") return { tone: "brand", text: "составить ТП" };
  if (tp.state === "fix") return { tone: "warn", text: `ТП: ${tp.status}`, icon: "pen" };
  return { tone: "brand", text: "проверить заявку" };
}

// Срок подачи бейджем: янтарный — неделя и меньше, серый — дальше или уже прошёл. long — «5 дней до подачи».
export function dueBadge(p: Purchase, long = false): BadgeInfo {
  const due = dueLine(p.deadline, false);
  if (!due) return { tone: "calm", text: "срок не найден" };
  if (due.days < 0) return { tone: "calm", text: due.head.replace(/^Приём заявок закончился /, "") };
  const text = due.days === 0 ? "подать сегодня" : long ? `${daysText(due.days)} до подачи` : daysText(due.days);
  return { tone: due.tone === "soon" ? "warn" : "calm", text, icon: "clock" };
}
