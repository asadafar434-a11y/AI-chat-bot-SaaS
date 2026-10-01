// Где в документах закупки стоит цитата — страница, таблица и строка, лист и ячейка, пункт, раздел. Нужна, чтобы про любое
// требование, пункт ТП или находку проверки можно было сказать, откуда оно взялось, а не только «ТЗ, п. 2.1» со слов ИИ.
// Работает в браузере: тексты и карты документов лежат там же, а сервер ничего не хранит.
import { clauseBefore, headingBefore, pagesFromMarkers, spanAt, spanIndexAt, type DocMap } from "@/lib/doc-source";
import { matchQuote, normalize, type Normalized } from "@/lib/quotes";

export type LocatableDoc = { name: string; text: string; map?: DocMap };

export type Located = {
  doc: string;
  // Место в тексте документа.
  from: number;
  to: number;
  page?: number;
  // Страницы Word — по разметке, которую оставил Word: у другого компьютера они могут сместиться.
  pageApprox?: true;
  ocr?: true;
  table?: number;
  row?: number;
  col?: number;
  // Заголовок столбца, если у таблицы есть шапка.
  colName?: string;
  sheet?: string;
  cell?: string;
  clause?: string;
  section?: string;
  // Сколько ещё таких мест есть в документах.
  more: number;
};

export type Locator = {
  locate: (quote: string) => Located | null;
  at: (doc: string, from: number, to?: number) => Located | undefined;
};

type Prepared = { doc: LocatableDoc; map: DocMap | undefined; norm?: Normalized; heads?: number[]; headers?: Map<string, string> };

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// Номера кусков-заголовков по порядку — чтобы быстро найти ближайший заголовок выше места.
const headsOf = (p: Prepared): number[] => (p.heads ??= (p.map?.spans ?? []).flatMap((s, i) => (s.head ? [i] : [])));

// Шапка таблицы — первая строка: по её ячейкам столбцам даются названия.
function headersOf(p: Prepared): Map<string, string> {
  if (!p.headers) {
    p.headers = new Map();
    for (const s of p.map?.spans ?? []) {
      if (s.table !== undefined && s.row === 1 && s.col !== undefined) {
        const name = p.doc.text.slice(s.from, s.to).replace(/\s+/g, " ").trim();
        if (name) p.headers.set(`${s.table}:${s.col}`, cut(name, 40));
      }
    }
  }
  return p.headers;
}

function placeOf(p: Prepared, from: number, to: number): Located {
  const out: Located = { doc: p.doc.name, from, to, more: 0 };
  const map = p.map;
  const span = spanAt(map, from);
  if (span) {
    if (span.page !== undefined) {
      out.page = span.page;
      if (map?.pagesApprox) out.pageApprox = true;
    }
    if (span.ocr) out.ocr = true;
    if (span.table !== undefined) {
      out.table = span.table;
      out.row = span.row;
      out.col = span.col;
      const name = span.row !== undefined && span.row > 1 && span.col !== undefined ? headersOf(p).get(`${span.table}:${span.col}`) : undefined;
      if (name) out.colName = name;
    }
    if (span.sheet !== undefined) {
      out.sheet = span.sheet;
      out.cell = span.cell;
    }
  }
  const clause = clauseBefore(p.doc.text, from);
  if (clause) out.clause = clause;
  // Заголовки отмечены в карте (Word) — берём ближайший выше; не отмечены (PDF, скан, текст) — ищем по виду строк.
  const heads = headsOf(p);
  let section: string | undefined;
  if (heads.length) {
    const at = spanIndexAt(map!.spans, from);
    let lo = 0;
    let hi = heads.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (heads[mid] <= at) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found >= 0) {
      const h = map!.spans[heads[found]];
      section = p.doc.text.slice(h.from, h.to);
    }
  } else {
    section = headingBefore(p.doc.text, from);
  }
  if (section) out.section = cut(section.replace(/\s+/g, " ").trim(), 100);
  return out;
}

export function createLocator(documents: LocatableDoc[]): Locator {
  // У документов, сохранённых до карты, страницы узнаём по меткам «-- 5 of 12 --» в тексте PDF.
  const prepared: Prepared[] = documents.map((doc) => ({ doc, map: doc.map ?? pagesFromMarkers(doc.text) }));
  const normOf = (p: Prepared) => (p.norm ??= normalize(p.doc.text));

  return {
    locate(quote) {
      // Сначала документ, где есть цитата целиком; потом — где есть хотя бы её начало.
      for (const all of [true, false]) {
        const hits = prepared.flatMap((p) => (matchQuote(quote, normOf(p), { all }) ?? []).map((m) => ({ p, m })));
        if (hits.length) {
          const { p, m } = hits[0];
          return { ...placeOf(p, m.from, m.to), more: hits.length - 1 };
        }
      }
      return null;
    },
    at(doc, from, to = from) {
      const p = prepared.find((x) => x.doc.name === doc);
      return p && placeOf(p, from, to);
    },
  };
}

// Адрес словами: «стр. 5, таблица 2, строка 3, «Количество», п. 2.4.1, раздел «Требования к заявке»».
export function describeLocation(l: Located): string {
  const parts: string[] = [];
  if (l.sheet !== undefined) parts.push(`лист «${l.sheet}»`);
  if (l.page !== undefined) parts.push(`${l.pageApprox ? "≈ " : ""}стр. ${l.page}${l.ocr ? " (скан)" : ""}`);
  if (l.table !== undefined) {
    const where = [`таблица ${l.table}`, l.row !== undefined && `строка ${l.row}`, l.colName ? `«${l.colName}»` : l.col !== undefined && `столбец ${l.col}`];
    parts.push(where.filter(Boolean).join(", "));
  }
  if (l.cell) parts.push(`ячейка ${l.cell}`);
  if (l.clause) parts.push(`п. ${l.clause}`);
  if (l.section) parts.push(`раздел «${cut(l.section, 60)}»`);
  return parts.join(", ");
}

// Строка для экрана: «ТЗ.docx — стр. 5, п. 2.4.1» (и «ещё 2 места», если цитата повторяется).
export function describeSource(l: Located): string {
  const where = describeLocation(l);
  const more = l.more > 0 ? ` · ещё ${l.more} ${l.more === 1 ? "место" : l.more < 5 ? "места" : "мест"}` : "";
  return `«${l.doc}»${where ? ` — ${where}` : ""}${more}`;
}
