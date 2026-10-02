// Что показать про факт базы доказательств: бейдж срока, строки полей и числа, откуда известен факт, общая сводка. Вид — на экране
// (design-system/prototype: EvidenceBase.tsx), здесь только слова и цвета, чтобы их проверяли тесты (npm test).
import { EXPIRING_DAYS, FACT_KINDS, validityAt, validityText, type Fact } from "@/lib/evidence-base";
import type { EvidenceStatus, Gap } from "@/lib/evidence-match";
import { plural } from "@/lib/plural";

export type BadgeTone = "neutral" | "warn" | "danger" | "success" | "info";

// Цвета статусов проверки: зелёный — подтверждено; янтарь — нужно добавить документ или скоро кончится срок; красный — просрочено
// или не подходит; индиго — решает человек (так же, как «ввести вручную» на шаге «Проверка»).
export const STATUS_TONE: Record<EvidenceStatus, BadgeTone> = {
  ok: "success",
  expiring: "warn",
  expired: "danger",
  mismatch: "danger",
  needs_evidence: "warn",
  need_human: "info",
};

// Что делать, словами: подсказка у статуса.
export const STATUS_HINT: Record<EvidenceStatus, string> = {
  ok: "В базе есть документ или факт, он действует и подходит под требование.",
  expiring: "Подходит, но срок действия кончится вскоре после даты подачи заявки.",
  expired: "Документ просрочен на дату подачи или старше, чем просит заказчик, — нужен новый.",
  mismatch: "В базе есть, но не подходит: число меньше требуемого, договоров не хватает или срок ещё не начался.",
  needs_evidence: "В базе нет того, чем это подтвердить. Система ничего не подставляет: добавьте документ или факт.",
  need_human: "В базе есть, но решить автоматически нельзя: найдено ИИ и не подтверждено, нет срока или числа, не ясно, какой документ нужен.",
};

// Закупки, которым это нужно, одной строкой: «Закупка: «А»», «Закупки: «А», «Б» и ещё 2».
export function gapPurchases(gap: Pick<Gap, "purchases">, show = 2): string {
  const names = gap.purchases.map((p) => `«${p.title}»`);
  const rest = names.length - show;
  return `${names.length === 1 ? "Закупка" : "Закупки"}: ${names.slice(0, show).join(", ")}${rest > 0 ? ` и ещё ${rest}` : ""}`;
}

const dm = (iso: string) => iso.split("-").reverse().join(".");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// Откуда потребность, по строке на требование: «Критерий оценки: «Квалификация участников — …»». Лишние — «и ещё 2 требования».
export function gapFrom(gap: Pick<Gap, "from">, show = 2): string[] {
  const lines = gap.from.slice(0, show).map((f) => `${f.basis}: «${clip(f.text.replace(/\s+/g, " "), 150)}»`);
  const rest = gap.from.length - show;
  if (rest > 0) lines.push(`и ещё ${rest} ${plural(rest, "требование", "требования", "требований")}`);
  return lines;
}

// Срок факта бейджем. У фактов, которым срок не нужен и не указан (сотрудник, договор), бейджа нет.
export function validityBadge(f: Fact, on: string): { text: string; tone: BadgeTone } | null {
  const at = validityAt(f.validity, on);
  const required = FACT_KINDS[f.kind].validity === "required";
  const text = validityText(f.validity, on);
  switch (at.state) {
    case "expired":
      return { text, tone: "danger" };
    case "not_started":
      return { text, tone: "warn" };
    case "perpetual":
      return { text, tone: "success" };
    case "valid":
      return { text, tone: at.days! <= EXPIRING_DAYS ? "warn" : "success" };
    case "unknown":
      return required ? { text, tone: "warn" } : null;
  }
}

// Поля факта строками для списка: «Номер: Л035…», «Дата выдачи: 12.05.2022», «вместимость: 200 мест». Пустые не показываются.
export function factLines(f: Fact): string[] {
  const lines: string[] = [];
  for (const def of FACT_KINDS[f.kind].fields) {
    const value = f.fields[def.key];
    if (value) lines.push(`${def.label}: ${"date" in def && def.date && /^\d{4}-\d{2}-\d{2}$/.test(value) ? dm(value) : value}`);
  }
  for (const m of f.measures) lines.push(`${m.what}: ${m.value.toLocaleString("ru-RU")}${m.unit ? ` ${m.unit}` : ""}`);
  return lines;
}

// Откуда известен факт: документ и место в нём или «вписано вручную». Это то, что делает факт доказательством.
export function sourceLine(f: Fact): string {
  if (f.source.type === "manual") return f.source.note ? `вписано вручную: ${f.source.note}` : "вписано вручную — документа нет";
  const { docName, where, quote } = f.source;
  return `из «${docName}»${where ? ` — ${where}` : ""}${quote ? `: «${clip(quote, 140)}»` : ""}`;
}

export type EvidenceSummary = {
  total: number;
  // Действуют: срок не кончился или документ бессрочный.
  valid: number;
  expiring: number;
  expired: number;
  // Срок нужен, но не указан.
  noTerm: number;
  // Нашёл ИИ, человек ещё не подтвердил.
  unconfirmed: number;
};

export function evidenceSummary(facts: Fact[], on: string): EvidenceSummary {
  const sum: EvidenceSummary = { total: facts.length, valid: 0, expiring: 0, expired: 0, noTerm: 0, unconfirmed: 0 };
  for (const f of facts) {
    const at = validityAt(f.validity, on);
    if (at.state === "expired") sum.expired++;
    else if (at.state === "valid" && at.days! <= EXPIRING_DAYS) sum.expiring++;
    else if (at.state === "valid" || at.state === "perpetual") sum.valid++;
    else if (at.state === "unknown" && FACT_KINDS[f.kind].validity === "required") sum.noTerm++;
    if (f.origin === "ai" && !f.confirmed) sum.unconfirmed++;
  }
  return sum;
}
