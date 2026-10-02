// Требования заказчика как структура. Модель выписывает пункты — текст, цитату, обязательность, тип, срок, числа, как проверить,
// чем подтвердить; код не верит ей на слово: числа и срок сверяются с цитатой, «не менее» читается из слов документа, а не из
// ответа модели, число в пересказе, которого нет в цитате, помечается. Модуль без зависимостей от браузера и сервера:
// им пользуется и сервер при разборе, и экран при показе — старые закупки получают числа из цитаты без повторного запроса к ИИ.
import { allNumbers, conditionsOf, describeCondition, unitKey, type Condition } from "@/lib/conditions";
import { normalize } from "@/lib/quotes";
import {
  NOT_GROUNDS,
  type DraftItem,
  type DraftNumber,
  type Mandatory,
  type ReqGroupKey,
  type ReqGroups,
  type ReqItem,
  type ReqType,
  type RequirementsDraft,
  REQ_GROUP_KEYS,
} from "@/lib/requirements";
import { parseRubles } from "@/lib/rub-words";

// Кусок цитаты на самом деле стоит в цитате — по тому же приведению к общему виду, что и сверка цитат (quotes.ts).
const within = (quote: string, piece: string) => {
  const p = normalize(piece, false).text;
  return p.length > 0 && normalize(quote, false).text.includes(p);
};

// Одно и то же условие: граница, вторая граница и единица (нет единицы у одного из двух — не помеха).
const same = (a: Condition, b: Condition) =>
  a.op === b.op &&
  a.value === b.value &&
  (a.value2 ?? 0) === (b.value2 ?? 0) &&
  (!a.unit || !b.unit || unitKey(a.unit) === unitKey(b.unit));

// Условие уже записано, если им названо то же число — граница или верхняя граница диапазона.
const covers = (c: Condition, a: DraftNumber) => c.value === a.value || c.value2 === a.value || (c.parts?.[0] === a.value && (c.parts?.length ?? 0) > 1);

// Числовые условия пункта. Главное — то, что код читает в цитате: слова «не менее», «не более», «от … до» берутся оттуда, а не
// из ответа модели. От модели — название («вместимость зала»), точные значения без границы и условия необычной формулировки,
// но только если дословный кусок стоит в цитате и число — в нём. Остальное отбрасывается, а причина идёт в issues.
export function refineNumbers(ai: DraftNumber[], quote: string): { numbers: Condition[]; issues: string[] } {
  const numbers: Condition[] = [];
  for (const c of conditionsOf(quote)) {
    if (numbers.some((x) => same(x, c))) continue;
    const named = ai.find((a) => covers(c, a));
    numbers.push(named?.what.trim() ? { ...c, what: named.what.trim() } : c);
  }
  const issues: string[] = [];
  for (const a of ai) {
    if (numbers.some((c) => covers(c, a))) continue;
    const raw = a.raw.trim();
    const wanted = a.op === "range" ? [a.value, a.value2] : [a.value];
    if (raw && within(quote, raw) && wanted.every((v) => allNumbers(raw).includes(v))) {
      numbers.push({
        what: a.what.trim(),
        op: a.op,
        value: a.value,
        ...(a.op === "range" && { value2: a.value2 }),
        unit: a.unit.trim(),
        raw,
      });
    } else {
      issues.push(`условие «${raw || a.what.trim() || a.value}» не найдено в цитате — не учтено`);
    }
  }
  return { numbers, issues };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace(".", ","));

// Числа пересказа, которых нет в цитате. Не считаются ошибкой начальная цена и процент от неё: «5 % — это 34 250 ₽» посчитано от цены.
function strayNumbers(text: string, quote: string, nmck: number | null): number[] {
  const have = new Set(allNumbers(quote));
  const derived: number[] = [];
  if (nmck) {
    derived.push(nmck);
    for (const p of have) if (p > 0 && p <= 100) derived.push((nmck * p) / 100);
  }
  const out: number[] = [];
  for (const v of allNumbers(text)) {
    if (have.has(v) || derived.some((d) => Math.abs(d - v) < 0.51) || out.includes(v)) continue;
    out.push(v);
  }
  return out;
}

// Тип по группе: «что подать» — всегда документ, «кто участвует» — к участнику; в остальных группах — как назвала модель,
// но срок и деньги — только из своих, а не «товар».
const TERMS_TYPES: ReqType[] = ["deadline", "money", "contract", "other"];
const typeFor = (group: ReqGroupKey, type: ReqType): ReqType =>
  group === "submit" ? "document" : group === "who" ? "participant" : group === "terms" ? (TERMS_TYPES.includes(type) ? type : "other") : type;

export type RefineContext = {
  // Цитата стоит в документах закупки дословно (quotes.ts: quoteChecker).
  found: (quote: string) => boolean;
  // Начальная цена, ₽, если известна.
  nmck: number | null;
};

export function refineItem(draft: DraftItem, group: ReqGroupKey, ctx: RefineContext): ReqItem {
  const { numbers, issues } = refineNumbers(draft.numbers, draft.quote);
  let deadline = draft.deadline.trim();
  if (deadline) {
    const stray = strayNumbers(deadline, draft.quote, null);
    if (stray.length) {
      issues.push(`срок «${deadline}» не найден в цитате`);
      deadline = "";
    }
  }
  const stray = strayNumbers(draft.text, draft.quote, ctx.nmck);
  if (stray.length) {
    const many = stray.length > 1;
    issues.push(`в пункте есть ${many ? "числа" : "число"} ${stray.map(fmt).join(", ")}, ${many ? "которых" : "которого"} нет в цитате: сверьте с документом`);
  }

  // Заказчик сам пишет, что без этого заявку не отклонят — по желанию, что бы ни ответила модель.
  const mandatory: Mandatory = NOT_GROUNDS.test(draft.text) || NOT_GROUNDS.test(draft.quote) ? "optional" : draft.mandatory;
  const evidence = [...new Set(draft.evidence.map((e) => e.trim()).filter(Boolean))];
  return {
    text: draft.text,
    source: draft.source,
    quote: draft.quote,
    verified: ctx.found(draft.quote),
    mandatory,
    type: typeFor(group, draft.type),
    deadline,
    numbers,
    check: draft.check.trim(),
    evidence,
    ...(issues.length > 0 && { issues }),
  };
}

export function refineGroups(draft: Pick<RequirementsDraft, ReqGroupKey | "price">, found: (quote: string) => boolean): ReqGroups {
  const ctx: RefineContext = { found, nmck: parseRubles(draft.price) };
  return Object.fromEntries(REQ_GROUP_KEYS.map((key) => [key, draft[key].map((item) => refineItem(item, key, ctx))])) as ReqGroups;
}

// ———— Требование для показа ————

export type RequirementGroup = ReqGroupKey | "criteria";

// Требование со всеми полями. Закупки, выписанные до появления полей, получают их так: числа — из цитаты (код читает их сам),
// тип — по группе, обязательность — «не указано», если заказчик сам не написал, что без этого не отклонят.
export type Requirement = {
  group: RequirementGroup;
  text: string;
  source: string;
  quote: string;
  verified: boolean;
  mandatory: Mandatory;
  type: ReqType;
  deadline: string;
  numbers: Condition[];
  check: string;
  evidence: string[];
  issues: string[];
};

const DEFAULT_TYPE: Record<ReqGroupKey, ReqType> = { who: "participant", submit: "document", scope: "service", terms: "other" };

export function requirementOf(item: ReqItem, group: ReqGroupKey): Requirement {
  return {
    group,
    text: item.text,
    source: item.source,
    quote: item.quote,
    verified: item.verified,
    mandatory: item.mandatory ?? (NOT_GROUNDS.test(item.text) || NOT_GROUNDS.test(item.quote) ? "optional" : "unclear"),
    type: item.type ?? DEFAULT_TYPE[group],
    deadline: item.deadline ?? "",
    numbers: item.numbers ?? conditionsOf(item.quote),
    check: item.check ?? "",
    evidence: item.evidence ?? [],
    issues: item.issues ?? [],
  };
}

// Условия, из которых участник выбирает значение сам: граница снизу или сверху, диапазон. Срок заказчика («в течение 5 рабочих
// дней») и точное значение («на 120 человек») — не выбор участника: он принимает их как написано.
export const supplierChoices = (r: Pick<Requirement, "numbers">): Condition[] => r.numbers.filter((c) => !c.term && c.op !== "exact");

// Как проверить, что предложение участника подходит: слова модели, если есть, и числа условий.
export function checkText(r: Pick<Requirement, "check" | "numbers" | "evidence">): string {
  const choices = supplierChoices(r).map((c) => `${c.what ? `${c.what}: ` : ""}${describeCondition(c)}`);
  const terms = r.numbers.filter((c) => c.term).map((c) => describeCondition(c));
  return [r.check, choices.length ? `в предложении участника — ${choices.join("; ")}` : "", terms.length ? `${terms.join("; ")} — условие заказчика, принимается как написано` : ""]
    .filter(Boolean)
    .join(". ");
}

// Пункт стоит сверить вручную: цитата не найдена дословно или в пересказе есть то, чего нет в цитате.
export const needsCheck = (r: Pick<Requirement, "verified" | "issues">) => !r.verified || r.issues.length > 0;
