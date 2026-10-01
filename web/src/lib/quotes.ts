// Сверка цитат с текстом документа и поиск места цитаты.
// Текст и цитата приводятся к одному виду: регистр, «ё», кавычки, тире, мягкие переносы, пробелы. Разделитель ячеек
// таблицы « | » — тоже пробел: цитата без него находится так же, как с ним (так документ читают таблицей, а ИИ нередко
// переписывает строку таблицы без «|»).

export type Normalized = {
  text: string;
  // Для каждого знака нормализованного текста — его позиция в исходном. null — позиции не нужны, считается только текст.
  at: number[] | null;
};

// Пробельные знаки, как у \s в JavaScript.
const isSpace = (code: number) =>
  code === 0x20 ||
  (code >= 0x09 && code <= 0x0d) ||
  code === 0xa0 ||
  code === 0x1680 ||
  (code >= 0x2000 && code <= 0x200a) ||
  code === 0x2028 ||
  code === 0x2029 ||
  code === 0x202f ||
  code === 0x205f ||
  code === 0x3000 ||
  code === 0xfeff;

const QUOTES = new Set(["«", "»", "“", "”", "„", '"']);

function normalizeChar(ch: string): string {
  const lower = ch.toLowerCase();
  if (lower === "ё") return "е";
  if (QUOTES.has(lower)) return '"';
  const code = lower.charCodeAt(0);
  if (lower.length === 1 && ((code >= 0x2010 && code <= 0x2015) || code === 0x2212)) return "-";
  return lower;
}

// Без позиций — цепочкой замен: она в несколько раз быстрее цикла, а текст у неё тот же (проверяют тесты).
const chain = (s: string) =>
  s
    .replace(/\|/g, " ")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»“”„"]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[­​]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function normalize(s: string, withPositions = true): Normalized {
  if (!withPositions) return { text: chain(s), at: null };
  let text = "";
  const at: number[] = [];
  // Исходный пробел, который запишем, как только встретим следующий знак: так пробелы по краям отбрасываются.
  let gap = -1;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (isSpace(code) || code === 0x7c) {
      if (text.length > 0 && gap < 0) gap = i;
      continue;
    }
    // Мягкий перенос и пробел нулевой ширины в тексте PDF и Word стоят где угодно — их не было.
    if (code === 0xad || code === 0x200b) continue;
    if (gap >= 0) {
      text += " ";
      at.push(gap);
      gap = -1;
    }
    const c = normalizeChar(s[i]);
    text += c;
    for (let k = 0; k < c.length; k++) at.push(i);
  }
  return { text, at };
}

const FRAGMENT_MIN = 8;

// Цитата делится на куски по многоточию; короче восьми знаков кусок ничего не доказывает.
export function fragmentsOf(quote: string): string[] {
  return quote
    .split(/\.{3}|…/)
    .map((f) => normalize(f, false).text)
    .filter((f) => f.length >= FRAGMENT_MIN);
}

// Цитата засчитывается, только если каждый её кусок есть в тексте документов: так модель не может выдать
// пересказ или выдумку за слова заказчика. Документы приводятся к общему виду один раз — проверка идёт по многим цитатам.
// prepared — тексты, которые уже приведены к общему виду (тексты законов: их не стоит приводить на каждый ответ заново).
export function quoteChecker(documents: string[], prepared: string[] = []): (quote: string) => boolean {
  const texts = [...documents.map((d) => normalize(d, false).text), ...prepared];
  return (quote) => {
    const fragments = fragmentsOf(quote);
    if (fragments.length === 0) return false;
    return fragments.every((f) => texts.some((t) => t.includes(f)));
  };
}

export const quoteFound = (quote: string, documents: string[]): boolean => quoteChecker(documents)(quote);

export type QuoteMatch = { from: number; to: number };

// Где в исходном тексте стоит первый кусок цитаты: все места (не больше limit), в позициях исходного текста.
// null — цитаты в этом тексте нет. По умолчанию в тексте должны быть все куски; all: false — достаточно первого
// (куски цитаты с многоточием могут лежать в разных документах).
export function matchQuote(quote: string, text: Normalized, { limit = 5, all = true } = {}): QuoteMatch[] | null {
  if (!text.at) throw new Error("matchQuote: текст нормализован без позиций");
  const fragments = fragmentsOf(quote);
  if (fragments.length === 0 || !(all ? fragments : fragments.slice(0, 1)).every((f) => text.text.includes(f))) return null;
  const first = fragments[0];
  const out: QuoteMatch[] = [];
  for (let at = text.text.indexOf(first); at >= 0 && out.length < limit; at = text.text.indexOf(first, at + 1)) {
    out.push({ from: text.at[at], to: text.at[at + first.length - 1] + 1 });
  }
  return out;
}
