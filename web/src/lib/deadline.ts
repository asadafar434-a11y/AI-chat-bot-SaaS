import { plural } from "@/lib/plural";
import type { Deadline } from "@/lib/requirements";

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

// head — сама дата, left — обратный отсчёт; text — всё вместе.
export type Due = { text: string; head: string; left?: string; tone: "soon" | "calm" | "past"; days: number };

const due = (head: string, tone: Due["tone"], days: number, left?: string): Due => ({
  text: left ? `${head} · ${left}` : head,
  head,
  left,
  tone,
  days,
});

// Срок подачи — самое важное в закупке: обратный отсчёт, янтарный за неделю до срока.
// withTime — для экрана закупки; в списке хватает даты.
export function dueLine({ date, time, zone }: Deadline, withTime: boolean): Due | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dueDate = new Date(y, mo - 1, d);
  if (dueDate.getMonth() !== mo - 1 || dueDate.getDate() !== d) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
  const day = `${d} ${MONTHS[mo - 1]}${y !== today.getFullYear() ? ` ${y}` : ""}`;
  const at = withTime && time.trim() ? [time.trim(), zone.trim()].filter(Boolean).join(" ") : "";

  if (days < 0) return due(`Приём заявок закончился ${day}`, "past", days);
  if (days === 0) return due(`Подать сегодня${at ? `, до ${at}` : ""}`, "soon", days);
  return due(
    `Подать до ${day}${at ? `, ${at}` : ""}`,
    days <= 7 ? "soon" : "calm",
    days,
    `осталось\u00a0${days}\u00a0${plural(days, "день", "дня", "дней")}`
  );
}

// Сначала то, что горит, потом закупки без срока, в конце — прошедшие, свежие выше.
export function byUrgency(a: Deadline, b: Deadline): number {
  const rank = (d: Due | null) => (d === null ? [1, 0] : d.days >= 0 ? [0, d.days] : [2, -d.days]);
  const [ra, da] = rank(dueLine(a, false));
  const [rb, db] = rank(dueLine(b, false));
  return ra - rb || da - db;
}
