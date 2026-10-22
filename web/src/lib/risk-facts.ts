// Отраслевые риски по найденным фактам, без платного ИИ: бесплатный поиск (lib/web-search.ts) приносит страницы с выдержками, код подсвечивает в выдержках числа — проценты роста и цены, —
// участник выбирает нужное, а рубли считает программа: затраты по статье × процент роста. У каждой суммы остаётся источник (сайт, ссылка, дословная выдержка) и дата поиска.
// Числа программа не выдумывает и сама не выбирает: подсвечено — кнопкой «Взять» подтверждает человек. Нет затрат по статье или процента — суммы нет, сказано, что вписать.

import type { SearchHit } from "@/lib/web-search";
import type { FactItem } from "@/lib/risk-estimate";

/** Гипотезы каталога (lib/hidden-costs.ts), для которых считается сумма «затраты × рост»: что вписать как базу и о чём процент. */
export const FACT_HYPOTHESES: Record<string, { base: string; growth: string }> = {
  materials: { base: "Затраты на материалы, ₽", growth: "Рост цен на материалы, %" },
  products: { base: "Затраты на продукты, ₽", growth: "Рост цен на продукты, %" },
  payroll: { base: "Фонд оплаты труда по контракту, ₽", growth: "Рост зарплат, %" },
  trips: { base: "Затраты на выезды и транспорт, ₽", growth: "Рост стоимости перевозок и топлива, %" },
  site: { base: "Выезд бригады и проживание, ₽", growth: "Рост цен на проживание и выезд, %" },
  licenses: { base: "Затраты на лицензии и облако, ₽", growth: "Рост цен на лицензии, %" },
};

/** Что сохраняется по гипотезе: затраты участника, выбранный процент и откуда он взят. */
export type RiskFact = {
  /** Затраты по статье, ₽ (вводит участник). */
  base: string;
  /** Процент роста цен (из выдержки или свой). */
  pct: string;
  /** Откуда процент: сайт и дата поиска; пусто — «свой». */
  source: string;
  url: string;
  /** Дословная выдержка, в которой стояло число. */
  quote: string;
};

export type RiskFacts = Record<string, RiskFact>;

export const EMPTY_FACT: RiskFact = { base: "", pct: "", source: "", url: "", quote: "" };

const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");

export function normalizeRiskFacts(raw: unknown): RiskFacts {
  if (!raw || typeof raw !== "object") return {};
  const out: RiskFacts = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(FACT_HYPOTHESES, id) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const fact: RiskFact = { base: str(v.base, 24), pct: str(v.pct, 12), source: str(v.source, 120), url: /^https?:\/\//i.test(str(v.url, 500)) ? str(v.url, 500) : "", quote: str(v.quote, 400) };
    if (fact.base || fact.pct) out[id] = fact;
  }
  return out;
}

// ——— Числа в выдержках ———

export type Candidate = {
  kind: "percent" | "rub";
  /** Число как написано («12,5»). */
  text: string;
  value: number;
  /** Рядом слова о росте цен: такое число подсвечивается как главное. */
  growth: boolean;
  /** Нижняя граница, если названа вилка («от 5 до 20 %», «1,5−3 %»): число — верхняя граница, худший случай. */
  from: string | null;
  /** Кусок выдержки вокруг числа. */
  context: string;
};

const GROWTH = /(?:рост|вырос|выраст|вырас|подорож|удорож|подскоч|увелич|повыс|прибав|индекс|инфляц|дорож|выше\s+(?:на|чем))/i;
const num = (s: string) => Number(s.replace(/[\s ]/g, "").replace(",", "."));
// Необязательное начало вилки («от 5 до 20 %», «1,5−3 %»), затем число и знак процента.
const PERCENT = /(?<![\d.,])(?:(?:от\s)?(\d{1,3}(?:[.,]\d{1,2})?)\s?(?:[–−-]|до)\s?)?([+\-−]?\d{1,3}(?:[.,]\d{1,2})?)\s?(?:%|процент)/gi;
const RUB = /(?<![\d.,])(\d{1,3}(?:[\s ]\d{3})*(?:[.,]\d{1,2})?)\s?(?:₽|руб(?:\.|л[а-яё]*)?)(?![а-яё])/gi;

/** Кусок текста вокруг числа по границам слов: начало и конец не рвут слова. */
function around(text: string, from: number, to: number): string {
  const a = Math.max(0, from);
  let b = Math.min(text.length, to);
  // Число с пробелами («62 500») не режем посередине: дочитываем его до конца.
  while (b < text.length && /\d/.test(text[b - 1] ?? "") && /\d/.test(text[b])) b++;
  const tail = /^[\s ]?\d{3}(?:[\s ]\d{3})*(?:[.,]\d+)?/.exec(text.slice(b));
  if (tail && /\d$/.test(text.slice(0, b).trimEnd())) b += tail[0].length;
  let piece = text.slice(a, b);
  if (a > 0 && /\S/.test(text[a - 1] ?? "") && /\S/.test(text[a] ?? "")) piece = piece.replace(/^\S+\s*/, "");
  if (b < text.length && /\S/.test(text[b] ?? "") && /\S/.test(text[b - 1] ?? "")) piece = piece.replace(/\s*\S+$/, "");
  return piece.trim();
}

/** Числа в выдержке: проценты (с пометкой «о росте») и суммы в рублях; с куском текста вокруг. Порядок — как в тексте, не больше шести. */
export function candidateNumbers(text: string): Candidate[] {
  const found: (Candidate & { at: number })[] = [];
  for (const m of text.matchAll(PERCENT)) {
    const value = num(m[2].replace("−", "-").replace("+", ""));
    if (!Number.isFinite(value) || Math.abs(value) > 300) continue;
    const at = m.index ?? 0;
    const context = around(text, at - 50, at + m[0].length + 30);
    found.push({ kind: "percent", text: m[2].replace(/^[+−-]/, ""), value: Math.abs(value), growth: GROWTH.test(text.slice(Math.max(0, at - 28), at + 12)), from: m[1] ?? null, context, at });
  }
  for (const m of text.matchAll(RUB)) {
    const value = num(m[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const at = m.index ?? 0;
    found.push({ kind: "rub", text: m[1], value, growth: false, from: null, context: around(text, at - 50, at + m[0].length + 30), at });
  }
  return found.sort((a, b) => a.at - b.at).slice(0, 6).map(({ at: _at, ...rest }) => rest);
}

/** Из результатов поиска — готовая запись факта: процент и откуда он. */
export function factFromHit(candidate: Candidate, hit: SearchHit, base: string): RiskFact {
  return { base, pct: candidate.text, source: hit.domain, url: hit.url, quote: candidate.context.slice(0, 400) };
}

// ——— Рубли ———

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const ru = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ");

export function riskFactAmount(fact: RiskFact): { base: number; pct: number; amount: number } | null {
  const base = num(fact.base);
  const pct = num(fact.pct);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(pct) || pct <= 0 || pct > 300) return null;
  return { base, pct, amount: round2((base * pct) / 100) };
}

/** Строки для «Сколько это может стоить»: затраты × рост, источник называется. Не всё вписано — «не определено» и что вписать. */
export function riskFactItems(facts: RiskFacts, titles: Record<string, string>): FactItem[] {
  const items: FactItem[] = [];
  for (const [id, fact] of Object.entries(facts)) {
    const title = titles[id] ?? id;
    const cfg = FACT_HYPOTHESES[id];
    if (!cfg) continue;
    const calc = riskFactAmount(fact);
    const where = fact.source ? `Источник: ${fact.source}${fact.url ? ` (${fact.url})` : ""}` : "Процент вписан вами";
    if (!calc) {
      const need = [!(num(fact.base) > 0) ? cfg.base.replace(/, ₽$/, "") : "", !(num(fact.pct) > 0) ? "процент роста" : ""].filter(Boolean);
      items.push({ id: `fact-${id}`, title: `${title}: рост цен`, scenario: "Сумма считается как затраты по статье × рост цен", amount: null, basis: where, kind: "unknown", inTotal: false, ask: `Впишите: ${need.join(", ")}` });
      continue;
    }
    items.push({
      id: `fact-${id}`,
      title: `${title}: рост цен на ${ru(calc.pct)} %`,
      scenario: `${ru(calc.base)} ₽ × ${ru(calc.pct)} %${fact.quote ? ` — «${fact.quote}»` : ""}`,
      amount: calc.amount,
      basis: where,
      kind: "estimate",
      inTotal: true,
    });
  }
  return items;
}
