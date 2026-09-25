import law44 from "@/data/laws/44-fz.json";
import law223 from "@/data/laws/223-fz.json";
import { quoteFound } from "@/lib/quotes";

// Тексты 44-ФЗ и 223-ФЗ в действующей редакции с официального портала pravo.gov.ru, по статьям.
// Обновляются скриптом scripts/fetch-laws.mjs — обычно после 1 января и 1 сентября.
type Article = { num: string; title: string; chapter: string; section?: string; text: string };
type Law = {
  name: string;
  title: string;
  edition: { rdk: string; label: string; date: string; by: string };
  source: string;
  repealed: string[];
  articles: Article[];
};

const LAWS = [law44, law223] as Law[];

export const LAW_NAMES = ["44-ФЗ", "223-ФЗ"] as const;
export type LawName = (typeof LAW_NAMES)[number];

export type LawPick = { law: LawName; article: string };

const MAX_ARTICLE = 30_000;
const MAX_TOTAL = 60_000;

export const editionOf = (law: Law) =>
  `${law.name} в редакции от ${law.edition.date}${law.edition.by ? ` № ${law.edition.by}` : ""}`;

const repealedArticle = (a: Article) => !a.title && /^\(Статья утратила силу/.test(a.text);

// Оглавление обоих законов — по нему модель выбирает статьи к вопросу.
export function lawContents(): string {
  return LAWS.map((law) =>
    [
      `${editionOf(law)} «${law.title}»:`,
      ...law.articles.map((a) => `ст. ${a.num}. ${repealedArticle(a) ? "утратила силу" : a.title}`),
      ...law.repealed.map((r) => `${r} — утратили силу`),
    ].join("\n")
  ).join("\n\n");
}

// ---------- слова вопроса ----------

const STOP = new Set(
  "для при что как или это если его она они так все был была было были может можно нужно надо какой какая какие каких когда где есть ли уже еще ещё чем чтобы том тот эта этот эти без над под про через после перед между также только".split(" ")
);

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

// Грубая основа слова: без двух последних букв хватает, чтобы «заявки» нашлось в «заявка».
const stems = (query: string) =>
  [...new Set(norm(query).match(/[а-яa-z0-9]{3,}/g) ?? [])]
    .filter((w) => !STOP.has(w))
    .map((w) => (w.length > 5 ? w.slice(0, w.length - 2) : w));

// ---------- части и пункты ----------

const PART = /^(\d+(?:\.\d+)*)\. /;
const POINT = /^(\d+(?:\.\d+)*)\) /;

function splitParts(text: string) {
  const parts: { num: string; lines: string[] }[] = [{ num: "", lines: [] }];
  for (const line of text.split("\n")) {
    const m = PART.exec(line);
    if (m) parts.push({ num: m[1], lines: [line] });
    else parts[parts.length - 1].lines.push(line);
  }
  return parts.filter((p) => p.lines.length);
}

// Пункт тянется до следующего пункта: подпункты «а)» и пометки о редакции остаются при нём.
function splitPoints(lines: string[]) {
  const points: string[][] = [[]];
  for (const line of lines) {
    if (POINT.test(line)) points.push([line]);
    else points[points.length - 1].push(line);
  }
  return points.filter((p) => p.length).map((p) => p.join("\n"));
}

const relevance = (text: string, words: string[]) => {
  const t = norm(text);
  return words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
};

// Из кусков — частей или пунктов — берём самые близкие к вопросу, пока влезают, и ставим их по порядку.
function fitPieces(pieces: string[], words: string[], budget: number, split?: (piece: string) => string[]): string[] {
  const ranked = pieces.map((text, i) => ({ text, i })).sort((a, b) => relevance(b.text, words) - relevance(a.text, words));
  const chosen: { text: string; i: number }[] = [];
  let size = 0;
  for (const piece of ranked) {
    const room = budget - size;
    if (room < 500) break;
    const text = piece.text.length <= room ? piece.text : split ? fitPieces(split(piece.text), words, room).join("\n") : "";
    if (!text) continue;
    chosen.push({ text, i: piece.i });
    size += text.length;
  }
  return chosen.sort((a, b) => a.i - b.i).map((c) => c.text);
}

// Длинные статьи (ст. 93 44-ФЗ — 75 тыс. знаков) целиком не нужны: оставляем части и пункты со словами из вопроса.
function fitArticle(article: Article, words: string[]): string {
  if (article.text.length <= MAX_ARTICLE) return article.text;
  const parts = splitParts(article.text).map((p) => p.lines.join("\n"));
  const kept = fitPieces(parts, words, MAX_ARTICLE, (part) => {
    const [intro, ...points] = splitPoints(part.split("\n"));
    return [intro, ...points];
  });
  return `${kept.join("\n…\n")}\n… (статья длинная — показаны части, где больше всего слов из вопроса)`;
}

const findArticle = (law: string, num: string) => {
  const found = LAWS.find((l) => l.name === law);
  return found && { law: found, article: found.articles.find((a) => a.num === num.trim()) };
};

// Тексты выбранных статей для запроса к модели: заголовок, редакция и сам текст.
export function lawExcerpts(picks: LawPick[], query: string): { text: string; laws: string[] } {
  const words = stems(query);
  const blocks: string[] = [];
  const laws = new Set<string>();
  let total = 0;
  for (const pick of picks) {
    const found = findArticle(pick.law, pick.article);
    if (!found?.article) continue;
    const body = fitArticle(found.article, words);
    if (total + body.length > MAX_TOTAL) break;
    total += body.length;
    laws.add(editionOf(found.law));
    const title = found.article.title || "утратила силу";
    blocks.push(`${found.law.name}, ст. ${found.article.num}. ${title}\n${body}`);
  }
  if (!blocks.length) return { text: "", laws: [] };
  return {
    text: `Тексты статей к этому вопросу — ${[...laws].join(", ")}, официальный портал pravo.gov.ru:\n\n${blocks.join("\n\n———\n\n")}`,
    laws: [...laws],
  };
}

// ---------- поиск по словам ----------

const UNITS = LAWS.flatMap((law) =>
  law.articles
    .filter((a) => !repealedArticle(a))
    .flatMap((a) =>
      splitParts(a.text).map((p) => ({
        law: law.name,
        num: a.num,
        part: p.num,
        title: a.title,
        titleNorm: norm(a.title),
        textNorm: norm(p.lines.join(" ")),
      }))
    )
);

export type LawHit = { law: string; num: string; part: string; title: string };

// Подсказка для выбора статей: части, где встречается больше всего слов из вопроса.
export function searchLaws(query: string, limit = 8): LawHit[] {
  const words = stems(query);
  if (!words.length) return [];
  const best = new Map<string, { hit: LawHit; score: number }>();
  for (const u of UNITS) {
    const score = words.reduce((n, w) => n + (u.textNorm.includes(w) ? 1 : 0) + (u.titleNorm.includes(w) ? 2 : 0), 0);
    if (!score) continue;
    const key = `${u.law} ${u.num}`;
    const prev = best.get(key);
    if (!prev || score > prev.score) best.set(key, { hit: { law: u.law, num: u.num, part: u.part, title: u.title }, score });
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((b) => b.hit);
}

// ---------- сверка цитат ----------

const LAW_TEXTS = LAWS.flatMap((law) => law.articles.map((a) => a.text));

type QuoteCheck = { total: number; missing: string[] };

// Цитата в «» из ответа ищется дословно в законах и в документах разговора.
export function checkQuotes(answer: string, documents: string[]): QuoteCheck {
  const quotes = [...answer.matchAll(/«([^«»]{25,})»/g)].map((m) => m[1]);
  const texts = [...LAW_TEXTS, ...documents];
  const missing = quotes.filter((q) => !quoteFound(q, texts));
  return { total: quotes.length, missing };
}

const short = (q: string) => (q.length > 90 ? `${q.slice(0, 90).trimEnd()}…` : q);

// Строка под ответом: по какой редакции закона он дан и нашлись ли цитаты дословно.
export function quotesNote({ total, missing }: QuoteCheck, laws: string[]): string {
  const lines: string[] = [];
  if (laws.length) lines.push(`Статьи закона — из официального текста: ${laws.join(", ")}.`);
  if (total && !missing.length) {
    lines.push(total === 1 ? "Цитата сверена с текстом дословно." : `Все цитаты (${total}) сверены с текстом дословно.`);
  } else if (missing.length) {
    lines.push(
      `Дословно нашлись ${total - missing.length} из ${total} цитат. Не нашёл: ${missing.map((q) => `«${short(q)}»`).join("; ")} — сверьте с первоисточником.`
    );
  }
  return lines.length ? `\n\n_${lines.join(" ")}_` : "";
}
