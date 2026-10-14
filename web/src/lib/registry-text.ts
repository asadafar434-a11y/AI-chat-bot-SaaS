// Нормализация текста для сопоставления товара с записью реестра. Только чистый код: ни базы, ни сети, ни ИИ.
// Всё, что отсюда выходит, — признаки для сравнения; решение о совпадении принимает registry-decision.ts.

/** Кириллица и похожая на неё латиница: «А» и «A» в моделях пишут вперемешку. */
const LOOKALIKE: Record<string, string> = { A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х", Y: "У" };

/** Строка для точного сравнения обозначений: заглавные, одинаковый алфавит, без пробелов и знаков. */
export function compact(value: string): string {
  return value
    .toUpperCase()
    .replace(/Ё/g, "Е")
    .replace(/[A-Z]/g, (ch) => LOOKALIKE[ch] ?? ch)
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export const lowerWords = (value: string): string[] => value.toLowerCase().replace(/ё/g, "е").match(/[\p{L}\p{N}]+/gu) ?? [];

const STOP = new Set([
  "для", "из", "на", "по", "при", "под", "над", "без", "или", "и", "в", "с", "со", "к", "от", "до", "за", "как", "что", "это", "типа", "тип", "вид",
  "прочий", "прочие", "прочая", "прочее", "иной", "иные", "других", "другие", "не", "их", "его", "ее", "также", "марка", "марки", "модель", "модели",
  "размер", "размеры", "цвет", "комплект", "набор", "серии", "серия", "шт", "штук", "россия", "рф",
]);

/** Грубая основа слова: «кресло», «кресла», «кресел» → одна основа. Мягче настоящего стеммера, этого хватает для поиска кандидатов. */
export const stemWord = (word: string): string => (word.length <= 3 ? word : word.length <= 5 ? word.slice(0, -1) : word.slice(0, -2));

/** Значимые слова названия — основы без служебных слов и чисел. */
export function nameTerms(name: string): string[] {
  const out: string[] = [];
  for (const word of lowerWords(name)) {
    if (STOP.has(word) || word.length < 3 || /^\p{N}+$/u.test(word)) continue;
    const stem = stemWord(word);
    if (!out.includes(stem)) out.push(stem);
  }
  return out;
}

/** Значимые слова названия целиком (не основы): служебные слова и числа отброшены, порядок сохранён. */
export function nameWords(name: string): string[] {
  const out: string[] = [];
  for (const word of lowerWords(name)) {
    if (STOP.has(word) || word.length < 3 || /^\p{N}+$/u.test(word)) continue;
    if (!out.includes(word)) out.push(word);
  }
  return out;
}

/** Слово похоже на прилагательное («мужская», «зимние», «рабочий»): существительное товара — не оно. */
const ADJECTIVE_END = /(ая|яя|ое|ее|ый|ий|ой|ые|ие|ую|юю|ого|его|ых|их|ым|им)$/;

/**
 * Названия для поиска, от точного к общему: «куртки для самбо» → [куртки самбо], [куртки]; «мужская куртка зимняя» → [мужская куртка зимняя],
 * [мужская куртка], [куртка]. Уточняющие слова отбрасываются с конца, а последним остаётся главное слово — первое, не похожее на
 * прилагательное. Так «куртки для самбо», которых в реестре нет, не мешают найти просто куртки.
 */
export function nameBroadenings(words: string[]): string[][] {
  const out: string[][] = [];
  for (let n = words.length; n >= 2; n--) out.push(words.slice(0, n));
  const head = words.find((w) => !ADJECTIVE_END.test(w)) ?? words[0];
  if (head) out.push([head]);
  return out;
}

const STANDARD_RE = /(?<![\p{L}])(ГОСТ\s*Р?|ТУ|ОСТ|СТО|ТО)\s*([\d][\d.\-–—/\s]*[\d](?:\s*[\-–—]\s*\d{2,4})?)/giu;

/** Ссылки на стандарты и технические условия («ТУ 3742-002-24039780-2003», «ГОСТ 16371-2014») в сжатом виде. */
// В реестре ТУ пишут и «ТУ 3742-002-…», и «801.222.000.000 ТУ» (код, потом «ТУ»): оба вида сводятся к одному.
const TU_AFTER_RE = /(?<![\p{L}\d])([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9.\-–/]{3,}[0-9A-Za-zА-Яа-яЁё])\s+ТУ(?![\p{L}])/gu;

export function standardRefs(value: string): string[] {
  const out = new Set<string>();
  for (const match of value.matchAll(STANDARD_RE)) {
    const kind = match[1].replace(/\s+/g, "").toUpperCase();
    out.add(compact(kind + match[2]));
  }
  for (const match of value.matchAll(TU_AFTER_RE)) out.add(compact(`ТУ${match[1]}`));
  return [...out];
}

/** Часть названия, где стандарты вырезаны: чтобы «ТУ 25.73» не принимать за обозначение модели. */
const withoutStandards = (value: string) => value.replace(STANDARD_RE, " ");

/**
 * Обозначения модели в названии: слова, где есть и буквы, и цифры («КТО 05/Х», «ПБСО-СМ», «ГФ-021», «DS-2CD2043»), либо
 * заглавные сокращения через дефис. Чистые числа и размеры («80 л», «3×2») моделью не считаются.
 */
export function modelTokens(value: string): string[] {
  const out = new Set<string>();
  const text = withoutStandards(value);
  for (const raw of text.split(/[\s,;()«»"“”]+/u)) {
    const token = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (token.length < 2) continue;
    const hasDigit = /\d/.test(token);
    const hasLetter = /\p{L}/u.test(token);
    const isUnit = /^\d+(?:[.,]\d+)?(?:мм|см|м|кг|г|л|вт|квт|в|а|гц|мпа|кпа|%)$/iu.test(token);
    if (isUnit) continue;
    if (hasDigit && hasLetter) out.add(compact(token));
    else if (!hasDigit && /^[A-ZА-ЯЁ]{2,}[\-–][A-ZА-ЯЁ0-9]{1,}/u.test(token)) out.add(compact(token));
  }
  return [...out];
}

const LEGAL_FORMS = [
  "общество с ограниченной ответственностью", "акционерное общество", "публичное акционерное общество", "закрытое акционерное общество",
  "открытое акционерное общество", "непубличное акционерное общество", "федеральное государственное унитарное предприятие",
  "государственное унитарное предприятие", "муниципальное унитарное предприятие", "индивидуальный предприниматель",
  "общество с дополнительной ответственностью", "производственный кооператив", "товарищество",
];
const LEGAL_ABBR = new Set(["ооо", "ао", "зао", "пао", "оао", "нпао", "фгуп", "гуп", "муп", "ип", "нпо", "нпп", "нпф", "пк", "тоо", "ук"]);

/** Слова названия организации без организационно-правовой формы: «ООО «Каскад»» и «Общество … «КАСКАД»» дают одно и то же. */
export function orgWords(name: string): string[] {
  let text = name.toLowerCase().replace(/ё/g, "е");
  for (const form of LEGAL_FORMS) text = text.split(form).join(" ");
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !LEGAL_ABBR.has(w));
}

export const orgKey = (name: string): string => orgWords(name).join(" ");

/** Названия организаций совпадают, если одинаковы слова без формы (порядок не важен). */
export function sameOrg(a: string, b: string): boolean {
  const x = [...orgWords(a)].sort().join(" ");
  const y = [...orgWords(b)].sort().join(" ");
  return x.length > 0 && x === y;
}

/** Организации явно разные: у названий нет ни одного общего значимого слова. */
export function differentOrg(a: string, b: string): boolean {
  const x = new Set(orgWords(a));
  const y = orgWords(b);
  if (x.size === 0 || y.length === 0) return false;
  return !y.some((w) => x.has(w));
}

export const isInn = (value: string): boolean => /^(\d{10}|\d{12})$/.test(value);
export const innOf = (value: string): string => value.replace(/\s+/g, "");

// ── ОКПД2 ──────────────────────────────────────────────────────────────────────────────────────────

const OKPD2_RE = /(?<![\d.])\d{2}\.\d{2}(?:\.\d{1,3}){0,2}(?![\d])/g;

/**
 * Все коды ОКПД2 в тексте. По виду код похож на дату («12.10.2026», «05.10.26»), поэтому здесь отсекаются только даты с
 * четырёхзначным годом; решать, чему верить, должен вызывающий — по подписи «ОКПД2» рядом (product-card.ts).
 */
export function okpd2In(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(OKPD2_RE)) {
    const code = match[0].replace(/\.$/, "");
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 5);
    if (/^\.\d{4}/.test(after)) continue;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

export const isOkpd2 = (value: string): boolean => /^\d{2}(?:\.\d{1,3}){0,3}$/.test(value);

const digitsOf = (code: string) => code.replace(/\D/g, "");

export type Okpd2Relation = "equal" | "inside" | "contains" | "same_class" | "different";

/**
 * Как соотносятся два кода ОКПД2. inside — первый конкретнее второго (31.01.12.160 внутри 31.01.12), contains — наоборот,
 * same_class — одна группа «31.01», но разные ветки, different — разные группы: это разные товары.
 */
export function okpd2Relation(a: string, b: string): Okpd2Relation {
  const x = digitsOf(a);
  const y = digitsOf(b);
  if (!x || !y) return "different";
  if (x === y) return "equal";
  if (x.startsWith(y)) return "inside";
  if (y.startsWith(x)) return "contains";
  if (x.slice(0, 4) === y.slice(0, 4) && x.length >= 4 && y.length >= 4) return "same_class";
  return "different";
}

// ── Числа с единицами ──────────────────────────────────────────────────────────────────────────────

const UNIT_ALIASES: Record<string, string> = {
  л: "л", литр: "л", литра: "л", литров: "л", мм: "мм", см: "см", м: "м", кг: "кг", г: "г", вт: "вт", квт: "квт", в: "в", а: "а", гц: "гц", мпа: "мпа", кпа: "кпа", бар: "бар", атм: "атм", мкм: "мкм",
};

export type Measure = { value: number; unit: string };

/** Числа с единицами измерения из названия или описания: «80 л», «220 В», «50 Гц». Без единицы число ничего не доказывает. */
export function measuresIn(text: string): Measure[] {
  const out: Measure[] = [];
  const re = /(?<![\p{L}\d.,])(\d+(?:[.,]\d+)?)\s*(литр\p{L}*|мкм|мм|см|квт|кпа|мпа|бар|атм|гц|вт|кг|л|м|г|в|а)(?![\p{L}\d])/giu;
  for (const match of text.matchAll(re)) {
    const unit = UNIT_ALIASES[match[2].toLowerCase()] ?? (match[2].toLowerCase().startsWith("литр") ? "л" : null);
    if (!unit) continue;
    const value = Number(match[1].replace(",", "."));
    if (Number.isFinite(value)) out.push({ value, unit });
  }
  return out;
}

/** Сколько слов из needles встречается среди haystack (по основам): 0..1. Нужно только для порядка в списке кандидатов. */
export function termOverlap(needles: string[], haystack: string[]): number {
  if (needles.length === 0) return 0;
  const set = new Set(haystack);
  return needles.filter((n) => set.has(n)).length / needles.length;
}
