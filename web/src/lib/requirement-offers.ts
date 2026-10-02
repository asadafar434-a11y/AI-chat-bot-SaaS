// «Заказчик требует» и «поставщик предлагает» — две разные записи. Требование — из документов закупки (requirement-engine.ts);
// предложение — строка технического предложения по тому же месту документа, а значения в ней — те, что вписал участник.
// Здесь они сводятся вместе для показа: что требует заказчик, что предложено, подходит ли и чего не хватает. Статус требования
// считается, а не хранится: он зависит от того, что участник вписал сегодня. Модуль без зависимостей от браузера и сервера.
import type { ApplicationField } from "@/lib/fields";
import type { PlanStatus } from "@/lib/fulfillment";
import type { Purchase } from "@/lib/purchase";
import { checkText, needsCheck, requirementOf, supplierChoices, type Requirement } from "@/lib/requirement-engine";
import { REQ_GROUP_KEYS } from "@/lib/requirements";
import type { TpResult } from "@/lib/tp";

// unverified — цитата не найдена или в пересказе числа, которых нет в цитате: сверьте с документом;
// open — ждёт ваших данных: значение, которое выбираете вы, или ТП ещё не составлено;
// check — в ТП есть ответ, его проверяет человек (ИИ ответ не утверждает);
// met — вписанное вами подходит под требование; violated — не подходит; info — условие заказчика, вписывать нечего.
export type ReqStatus = "unverified" | "open" | "check" | "met" | "violated" | "info";

export const STATUS_TEXT: Record<ReqStatus, string> = {
  unverified: "Сверьте с документом",
  open: "Нужны ваши данные",
  check: "Проверьте",
  met: "Подходит",
  violated: "Не подходит",
  info: "Условие заказчика",
};

// Строка ТП, которая отвечает на требование: пункт предложения или товар.
export type OfferRow = { kind: "item" | "good"; index: number; topic: string; text: string };

// Что с предложением: сколько мест ждёт вашего значения, сколько вписано, какие значения не подходят.
export type Offer = { rows: OfferRow[]; open: number; invalid: number; confirm: number; filled: number; problems: string[] };

export type RequirementView = Requirement & { id: string; status: ReqStatus; checkText: string; offer?: Offer };

type Span = { doc: string; from: number; to: number };

const rowsOf = (tp: TpResult): (OfferRow & { quote: string })[] => [
  ...tp.items.map((it, index) => ({ kind: "item" as const, index, topic: it.topic, text: it.offer, quote: it.quote })),
  ...tp.goods.map((g, index) => ({ kind: "good" as const, index, topic: g.name, text: g.characteristics, quote: g.quote })),
];

const overlap = (a: Span | null, b: Span | null) => Boolean(a && b && a.doc === b.doc && a.from < b.to && b.from < a.to);

// Что с предложением: по карте полей заявки (fields.ts), поля строки ТП — «tp:item:0:…», «confirm:guess:item:0».
export function offerSummary(rows: OfferRow[], fields: ApplicationField[]): Offer {
  const mine = fields.filter((f) => rows.some((r) => f.key === `tp:${r.kind}:${r.index}` || f.key.startsWith(`tp:${r.kind}:${r.index}:`) || f.key === `confirm:guess:${r.kind}:${r.index}`));
  return {
    rows,
    open: mine.filter((f) => f.status === "needs_input").length,
    invalid: mine.filter((f) => f.status === "invalid").length,
    confirm: mine.filter((f) => f.status === "needs_confirmation").length,
    filled: mine.filter((f) => f.status === "filled" && f.key.includes(":done:")).length,
    problems: mine.filter((f) => f.problem).map((f) => f.problem!),
  };
}

// Статус требования. plan — как выполняется пункт «Что подать» (fulfillment.ts); hasTp — составлено ли ТП.
export function statusOf(r: Requirement, ctx: { plan?: PlanStatus; offer?: Offer; hasTp: boolean }): ReqStatus {
  if (needsCheck(r)) return "unverified";
  if (r.group === "submit") return ctx.plan === "done" ? "met" : ctx.plan === "confirm" ? "check" : ctx.plan === "todo" ? "open" : "info";
  if (r.group !== "scope") return "info";
  const choices = supplierChoices(r).length > 0;
  const o = ctx.offer;
  if (!o || o.rows.length === 0) return choices ? "open" : ctx.hasTp ? "check" : "info";
  if (o.invalid) return "violated";
  if (o.open) return "open";
  if (o.confirm) return "check";
  // Подходит — когда значение вписал сам участник; текст ИИ без чисел участника — на проверку человеку.
  return choices && o.filled > 0 ? "met" : "check";
}

// Критерий оценки как требование: за него дают баллы, а не отклоняют.
export function criteriaRequirement(row: { criterion: string; indicator: string; detail: string; criterionWeight: string; scoring: string; proof: string; source: string; quote: string; verified: boolean }): Requirement {
  const name = [row.criterion, row.indicator, row.detail].map((s) => s.trim()).filter(Boolean).join(" — ");
  return {
    group: "criteria",
    text: row.criterionWeight.trim() ? `${name} (${row.criterionWeight.trim()})` : name,
    source: row.source,
    quote: row.quote,
    verified: row.verified,
    mandatory: "scored",
    type: "scoring",
    deadline: "",
    numbers: [],
    check: row.scoring,
    evidence: row.proof.trim() ? [row.proof.trim()] : [],
    issues: [],
  };
}

// Все требования закупки как структура: со статусом и, у требований ТЗ, с предложением участника. locate находит место цитаты
// в документах (doc-locate.ts): требование и строка ТП — об одном и том же, если места их цитат пересекаются.
export function requirementViews(
  p: Purchase,
  deps: { locate: (quote: string) => Span | null; fields: ApplicationField[]; plans?: { status: PlanStatus }[] }
): RequirementView[] {
  const cache = new Map<string, Span | null>();
  const span = (quote: string) => {
    if (!quote) return null;
    if (!cache.has(quote)) cache.set(quote, deps.locate(quote));
    return cache.get(quote)!;
  };
  const tpRows = p.tp ? rowsOf(p.tp) : [];
  const views: RequirementView[] = [];

  for (const group of REQ_GROUP_KEYS) {
    p.requirements[group].forEach((item, index) => {
      const r = requirementOf(item, group);
      const linked = group === "scope" ? tpRows.filter((row) => overlap(span(r.quote), span(row.quote))) : [];
      const offer = linked.length ? offerSummary(linked.map((row) => ({ kind: row.kind, index: row.index, topic: row.topic, text: row.text })), deps.fields) : undefined;
      views.push({
        ...r,
        id: `${group}-${index}`,
        status: statusOf(r, { plan: group === "submit" ? deps.plans?.[index]?.status : undefined, offer, hasTp: Boolean(p.tp) }),
        checkText: checkText(r),
        ...(offer && { offer }),
      });
    });
  }
  (p.criteria?.rows ?? []).forEach((row, index) => {
    const r = criteriaRequirement(row);
    views.push({ ...r, id: `criteria-${index}`, status: statusOf(r, { hasTp: Boolean(p.tp) }), checkText: checkText(r) });
  });
  return views;
}
