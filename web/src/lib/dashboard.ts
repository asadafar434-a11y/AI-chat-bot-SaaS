import { lawOfKind } from "@/lib/law-kind";
import type { Purchase } from "@/lib/purchase";
import { stepsOf, type Step } from "@/lib/steps";

// «Мои закупки»: список, как в прототипе, — статус, готовность, способ закупки. Всё считается из самой закупки,
// руками ничего не двигают, кроме отметки «Подана».
export type DashStatus = "draft" | "progress" | "ready" | "submitted";

export const STATUS_LABEL: Record<DashStatus, { text: string; tone: "calm" | "warn" | "ok"; hint: string }> = {
  draft: { text: "Черновик", tone: "calm", hint: "Документы разобраны — цена и заявка ещё не начаты." },
  progress: { text: "В работе", tone: "warn", hint: "Есть что заполнить или проверить." },
  ready: { text: "Готова к подаче", tone: "ok", hint: "Все шаги пройдены — осталось подписать и подать на площадке." },
  submitted: { text: "Подана", tone: "calm", hint: "Вы отметили, что заявка подана на площадке." },
};

export const FILTERS: { id: DashStatus | "all"; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "draft", label: "Черновики" },
  { id: "progress", label: "В работе" },
  { id: "ready", label: "Готовы" },
  { id: "submitted", label: "Поданы" },
];

// Доля пройденных шагов из пяти. Подана — 100.
export function progressOf(steps: Step[], submitted = false): number {
  if (submitted) return 100;
  return Math.round((steps.filter((s) => s.state === "done").length / steps.length) * 100);
}

export function statusOf(p: Purchase, steps: Step[] = stepsOf(p)): DashStatus {
  if (p.submitted) return "submitted";
  if (steps.every((s) => s.state === "done")) return "ready";
  const started = steps.filter((s) => s.key !== "upload" && s.key !== "analysis").some((s) => s.state !== "todo");
  return started ? "progress" : "draft";
}

// Куда вести по нажатию: первый шаг, где ещё есть работа; всё сделано — на последний.
export function nextHref(steps: Step[]): string {
  return (steps.find((s) => s.state !== "done") ?? steps[steps.length - 1]).href;
}

// «44-ФЗ · электронный аукцион» → «Электронный аукцион»; без способа — пустая строка.
export function procedureOf(p: Purchase): string {
  const way = p.kind.split("·").slice(1).join("·").trim();
  return way ? way[0].toUpperCase() + way.slice(1) : "";
}

export const lawText = (p: Purchase) => {
  const law = lawOfKind(p.kind);
  return law ? `${law}-ФЗ` : "";
};

// Поиск по названию, заказчику, предмету и способу закупки.
export function matches(p: Purchase, title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [title, p.customer, p.subject, p.kind, p.price].some((s) => s.toLowerCase().includes(q));
}

// Что значит способ закупки для участника — строкой под названием закупки, как в прототипе.
export function procedureHint(p: Purchase): string {
  const kind = p.kind.toLowerCase();
  if (/аукцион/.test(kind)) return "Торги на понижение в реальном времени. Побеждает наименьшая цена.";
  if (/котировк/.test(kind)) return "Одно ценовое предложение без торгов. Побеждает наименьшая цена.";
  if (/конкурс|запрос предложений/.test(kind)) return "Оценка по критериям: цена, опыт, квалификация — не только цена.";
  if (/единственн/.test(kind)) return "Прямой контракт без конкурентной процедуры.";
  return "";
}
