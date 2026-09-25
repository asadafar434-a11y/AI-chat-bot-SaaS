// Поиск по словам в документах закупки — прямо в браузере, без ИИ.
// Окончания не важны: слово ищется по основе, «гарантия» найдёт и «гарантии», и «гарантией».
// Фраза ищется целиком, слово за словом; если так её нет — каждое слово по отдельности.

const CHAR = "[\\p{L}\\p{N}]";
const START = `(?<!${CHAR})`;
// Между словами фразы — пробелы, переносы строк и знаки препинания: «обеспечение заявки», «обеспечения — заявки».
const GAP = "[^\\p{L}\\p{N}]{1,6}";
const MAX_WORDS = 8;
// Больше мест в одном документе не показываем — такой запрос лучше уточнить.
const MAX_HITS = 200;

export type Hit = { start: number; end: number };
export type DocHits = { name: string; scan?: boolean; text: string; hits: Hit[]; total: number };
export type SearchResult = { mode: "phrase" | "words"; words: string[]; docs: DocHits[] };

// «ё» и «е» для поиска — одна буква. Длина текста не меняется, поэтому места совпадают с исходным текстом.
const fold = (s: string) => s.replace(/ё/g, "е").replace(/Ё/g, "Е");

const isNumber = (w: string) => /^\p{N}+$/u.test(w);

// Образец одного слова. Числа и слова из одной-двух букв — целиком: «44» не найдёт «440», «в» — «вид».
// У остальных отбрасываем окончание: у слов из 4–5 букв — одну букву, у длинных — две.
function wordPattern(word: string): string {
  const w = fold(word).toLowerCase();
  if (isNumber(w) || w.length <= 2) return `${w}(?!${CHAR})`;
  const base = w.length <= 3 ? w : w.length <= 5 ? w.slice(0, -1) : w.slice(0, -2);
  return `${base}${CHAR}*`;
}

function run(documents: { name: string; text: string; scan?: boolean }[], pattern: string): DocHits[] {
  return documents.map(({ name, text, scan }) => {
    const re = new RegExp(pattern, "giu");
    const hits: Hit[] = [];
    let total = 0;
    for (const m of fold(text).matchAll(re)) {
      total++;
      if (hits.length < MAX_HITS) hits.push({ start: m.index, end: m.index + m[0].length });
    }
    return { name, scan, text, hits, total };
  });
}

export function searchDocuments(documents: { name: string; text: string; scan?: boolean }[], query: string): SearchResult | null {
  const words = (query.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_WORDS);
  if (words.join("").length < 2) return null;

  const phrase = run(documents, START + words.map(wordPattern).join(GAP));
  if (words.length === 1 || phrase.some((d) => d.total > 0)) return { mode: "phrase", words, docs: phrase };

  // Фразы целиком нет — ищем значимые слова по отдельности; предлоги и союзы нашлись бы везде.
  const meaningful = words.filter((w) => isNumber(w) || w.length > 2);
  if (meaningful.length === 0) return { mode: "phrase", words, docs: phrase };
  return { mode: "words", words: meaningful, docs: run(documents, `${START}(?:${meaningful.map(wordPattern).join("|")})`) };
}

export type Fragment = { from: number; to: number; marks: Hit[] };

// Места рядом друг с другом показываем одним отрывком: иначе один и тот же абзац повторится несколько раз.
export function fragmentsOf(text: string, hits: Hit[], radius: number): Fragment[] {
  const out: Fragment[] = [];
  for (const hit of hits) {
    const last = out.at(-1);
    if (last && hit.start - last.marks.at(-1)!.end <= radius * 2) {
      last.marks.push(hit);
      last.to = Math.min(text.length, hit.end + radius);
    } else {
      out.push({ from: Math.max(0, hit.start - radius), to: Math.min(text.length, hit.end + radius), marks: [hit] });
    }
  }
  // Края отрывка — по границе слов, чтобы не начинать и не заканчивать на половине слова.
  return out.map(({ from, to, marks }) => {
    let start = from;
    let end = to;
    if (start > 0) {
      const space = text.slice(start, marks[0].start).search(/\s/);
      if (space >= 0) start += space + 1;
    }
    if (end < text.length) {
      const tail = text.slice(marks.at(-1)!.end, end);
      const space = tail.search(/\s\S*$/);
      if (space >= 0) end = marks.at(-1)!.end + space;
    }
    return { from: start, to: end, marks };
  });
}

export type Piece = { text: string; mark: boolean };

// Отрывок для показа: переносы строк и двойные пробелы — одним пробелом, найденное помечено.
export function piecesOf(text: string, fragment: Fragment): Piece[] {
  const clean = (s: string) => s.replace(/\s+/g, " ");
  const pieces: Piece[] = [];
  let at = fragment.from;
  for (const m of fragment.marks) {
    if (m.start > at) pieces.push({ text: clean(text.slice(at, m.start)), mark: false });
    pieces.push({ text: clean(text.slice(m.start, m.end)), mark: true });
    at = m.end;
  }
  if (fragment.to > at) pieces.push({ text: clean(text.slice(at, fragment.to)), mark: false });
  if (pieces.length) {
    if (!pieces[0].mark) pieces[0].text = pieces[0].text.trimStart();
    const lastPiece = pieces.at(-1)!;
    if (!lastPiece.mark) lastPiece.text = lastPiece.text.trimEnd();
  }
  return pieces;
}
