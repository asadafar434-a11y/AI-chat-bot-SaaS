// Откуда взят каждый кусок текста документа. Текст документа остаётся одним куском — его читает ИИ, по нему сверяются
// цитаты. А рядом лежит карта: для диапазона знаков — страница, таблица, строка и столбец, лист и ячейка Excel,
// пометка «заголовок» и «распознано со скана». По карте любое место текста получает адрес: «стр. 5, таблица 2, строка 3».
// Модуль без зависимостей: им пользуются и сервер при чтении файлов, и браузер при показе источника.

export type DocSpan = {
  from: number;
  to: number;
  // Страница PDF или скана; у Word — по разметке страниц, которую оставил сам Word (DocMap.pagesApprox).
  page?: number;
  // Таблица документа, её строка и столбец — с единицы. Объединённая ячейка стоит в первом столбце, который занимает.
  table?: number;
  row?: number;
  col?: number;
  // Excel: лист и адрес ячейки, например «C17».
  sheet?: string;
  cell?: string;
  // Заголовок раздела: по стилю Word или по виду строки.
  head?: true;
  // Текст распознан ИИ со скана или фото: в цифрах возможны ошибки.
  ocr?: true;
};

export type DocMap = { spans: DocSpan[]; pagesApprox?: true };

export type SpanRef = Omit<DocSpan, "from" | "to">;

// Документ с тысячами ячеек не должен раздувать хранилище браузера: после предела куски сливаются в последний.
export const MAX_SPANS = 40_000;

const sameRef = (a: SpanRef, b: SpanRef) =>
  a.page === b.page && a.table === b.table && a.row === b.row && a.col === b.col && a.sheet === b.sheet && a.cell === b.cell && a.head === b.head && a.ocr === b.ocr;

// Подряд идущие абзацы одной страницы — один кусок. Ячейки, листы Excel и заголовки остаются каждый сам по себе.
const mergeable = (ref: SpanRef) => ref.table === undefined && ref.sheet === undefined && !ref.head;

// Собирает текст документа по кускам и записывает, откуда каждый. Разделители (перевод строки, « | ») — без адреса.
export class TextBuilder {
  private parts: string[] = [];
  private len = 0;
  readonly spans: DocSpan[] = [];

  get length() {
    return this.len;
  }

  raw(text: string): void {
    if (!text) return;
    this.parts.push(text);
    this.len += text.length;
  }

  add(text: string, ref: SpanRef = {}): void {
    if (!text) return;
    const from = this.len;
    this.parts.push(text);
    this.len += text.length;
    const last = this.spans[this.spans.length - 1];
    if (last && (this.spans.length >= MAX_SPANS || (mergeable(ref) && mergeable(last) && sameRef(last, ref)))) {
      last.to = this.len;
      return;
    }
    this.spans.push({ from, to: this.len, ...ref });
  }

  // Текст без пробелов в конце и карта; карты нет, если из неё нечего узнать (простой текстовый файл).
  build(approx = false): { text: string; map?: DocMap } {
    const text = this.parts.join("").replace(/\s+$/, "");
    const spans = this.spans.filter((s) => s.from < text.length).map((s) => ({ ...s, to: Math.min(s.to, text.length) }));
    const informative = spans.some((s) => s.page !== undefined || s.table !== undefined || s.sheet !== undefined || s.head || s.ocr);
    return { text, ...(informative && { map: { spans, ...(approx && { pagesApprox: true as const }) } }) };
  }
}

// Номер последнего куска, который начинается не позже позиции; -1 — раньше первого.
export function spanIndexAt(spans: DocSpan[], pos: number): number {
  let lo = 0;
  let hi = spans.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].from <= pos) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export const spanAt = (map: DocMap | undefined, pos: number): DocSpan | undefined => (map ? map.spans[spanIndexAt(map.spans, pos)] : undefined);

// Страницы PDF в тексте отмечены строкой «-- 5 of 12 --» после текста страницы. У документов, сохранённых до карты,
// страницы узнаём по этим меткам.
const PAGE_MARK = /\n\n-- (\d+) of \d+ --\n\n/g;

export function pagesFromMarkers(text: string): DocMap | undefined {
  const spans: DocSpan[] = [];
  let start = 0;
  for (const m of text.matchAll(PAGE_MARK)) {
    const end = m.index + m[0].length;
    if (end > start) spans.push({ from: start, to: end, page: Number(m[1]) });
    start = end;
  }
  return spans.length ? { spans } : undefined;
}

// ---------- номер пункта и заголовок раздела по самому тексту ----------

const singleLetterShare = (words: string[]) => (words.length ? words.filter((w) => /^\p{L}[.,:;]?$/u.test(w)).length / words.length : 0);

// «Раздел 4», «Приложение № 1», «Форма 3», «Статья 43» — слово и номер. Без номера («Форма заявки приведена…») — не заголовок.
const HEADING_WORD = /^(?:раздел|глава|часть|приложение|форма|статья)\s*(?:№\s*)?(?:\d+|[IVXLC]+)(?![\p{L}\p{N}])/iu;
const ROMAN = /^[IVXLC]{1,6}\.\s+\S/;

// Строка похожа на заголовок раздела: «Раздел 4. …», «II. ИЗВЕЩЕНИЕ …», строка из заглавных букв. «1. Общие положения» и
// пункты «1.1. Заказчик — …» по виду не отличить от начала пункта, который перенесён на вторую строку, — их здесь нет.
export function lineHeading(line: string): boolean {
  const s = line.trim();
  if (s.length < 3 || s.length > 160 || s.includes("|") || /^--\s*\d+ of \d+\s*--$/.test(s)) return false;
  const words = s.split(/\s+/);
  if (singleLetterShare(words) >= 0.5) return false;
  // Предложение заканчивается точкой и длиннее заголовка; «Раздел 4.» и «Статья 43. Содержание заявки.» — короткие.
  if (HEADING_WORD.test(s)) return s.length <= 110 && words.length <= 14 && !(/[;,]$/.test(s) || (s.endsWith(".") && words.length > 6));
  if (ROMAN.test(s)) return !/[;,]$/.test(s);
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters.length < 6 || s.length > 120) return false;
  return letters.replace(/[^\p{Lu}]/gu, "").length / letters.length >= 0.85;
}

// Пункт: «2.4.1. текст», «5. текст», «3) текст». Число без точки — не пункт: «14 ноября», «150 мест».
const CLAUSE = /^(?:(\d{1,3}(?:\.\d{1,3})+)\.?|(\d{1,3})[.)])\s+\S/;

const lineStartAt = (text: string, pos: number) => (pos <= 0 ? 0 : text.lastIndexOf("\n", pos - 1) + 1);

// Ближайшая строка выше места (или та же), подходящая под проверку. Дальше limit строк не смотрим.
function lineBefore<T>(text: string, pos: number, limit: number, test: (line: string) => T | undefined): T | undefined {
  let start = lineStartAt(text, Math.min(pos, text.length));
  for (let i = 0; i < limit; i++) {
    const end = text.indexOf("\n", start);
    const hit = test(text.slice(start, end < 0 ? text.length : end));
    if (hit !== undefined) return hit;
    if (start === 0) return undefined;
    // «\n» перед этой строкой — на start − 1; предыдущая строка начинается после «\n» перед ним.
    start = start === 1 ? 0 : lineStartAt(text, start - 1);
  }
  return undefined;
}

// Пункт, к которому относится место: ищем вверх не дальше пятнадцати строк — столько занимает один пункт.
export function clauseBefore(text: string, pos: number): string | undefined {
  return lineBefore(text, pos, 15, (line) => {
    const m = CLAUSE.exec(line.trim());
    return m ? (m[1] ?? m[2]) : undefined;
  });
}

// Заголовок раздела по виду строк — для документов, у которых заголовки не отмечены стилем (PDF, скан, текст).
export function headingBefore(text: string, pos: number): string | undefined {
  return lineBefore(text, pos, 4000, (line) => (lineHeading(line) ? line.trim() : undefined));
}

// Что видно о файле по карте: страниц, таблиц, листов Excel, страниц со скана — для строки под названием файла.
export type DocSummary = { pages: number; tables: number; sheets: number; scanPages: number; approx: boolean };

export function summaryOf(map: DocMap | undefined): DocSummary {
  const tables = new Set<number>();
  const sheets = new Set<string>();
  const scans = new Set<number>();
  let pages = 0;
  for (const s of map?.spans ?? []) {
    if (s.page !== undefined) pages = Math.max(pages, s.page);
    if (s.table !== undefined) tables.add(s.table);
    if (s.sheet !== undefined) sheets.add(s.sheet);
    if (s.ocr && s.page !== undefined) scans.add(s.page);
  }
  return { pages, tables: tables.size, sheets: sheets.size, scanPages: scans.size, approx: Boolean(map?.pagesApprox) };
}
