// Поиск закупок по фильтрам: закупка (TenderListing), фильтры (слова и исключения, закон, цена, даты, регион, способ), отбор и сортировка. Чистый код: данные берутся из любого источника
// (выгрузка из файла сейчас, лента ЕИС или сервис-агрегатор потом) — они приводятся к TenderListing, а отбор один и тот же. Закупок не придумывает: что в выгрузке не указано, то не указано.

export type TenderLaw = "44-ФЗ" | "223-ФЗ";

export type TenderListing = {
  /** Реестровый номер извещения; без него закупка не берётся. */
  id: string;
  law: TenderLaw | null;
  title: string;
  customer: string | null;
  /** Начальная (максимальная) цена, ₽. */
  price: number | null;
  /** Дата размещения, YYYY-MM-DD. */
  publishedAt: string | null;
  /** Окончание подачи заявок, YYYY-MM-DD. */
  deadline: string | null;
  region: string | null;
  method: string | null;
  url: string | null;
};

export type TenderFilters = {
  /** Слова через пробел; «-слово» исключает; «"фраза в кавычках"» ищется целиком. */
  query: string;
  /** any — оба закона. */
  law: "any" | "44" | "223";
  priceFrom: number | null;
  priceTo: number | null;
  publishedFrom: string | null;
  publishedTo: string | null;
  /** Только закупки, в которых приём заявок ещё идёт (дата окончания не раньше сегодняшнего дня). */
  activeOnly: boolean;
  /**
   * Слова запроса ищет сам ЕИС (по названию и по позициям закупки: «шапка» находит «спецодежду»), поэтому в загруженном списке они по умолчанию не режут: действуют только исключения «-слово».
   * Включено — в списке остаются только закупки, у которых слова есть в названии (по основе слова; «уголь» не находит заказчика «УГОЛОВНО-ИСПОЛНИТЕЛЬНАЯ ИНСПЕКЦИЯ»).
   */
  titleOnly: boolean;
  /** Заказчик: часть названия («Россети», «ГУФСИН»). */
  customer: string;
  region: string;
  method: string;
};

export const EMPTY_FILTERS: TenderFilters = { query: "", law: "any", priceFrom: null, priceTo: null, publishedFrom: null, publishedTo: null, activeOnly: true, titleOnly: false, customer: "", region: "", method: "" };

export type TenderSort = "deadline" | "newest" | "priceDesc" | "priceAsc";
export const SORT_LABELS: Record<TenderSort, string> = { deadline: "Скоро заканчивается", newest: "Новые", priceDesc: "Дороже", priceAsc: "Дешевле" };

// ——— Слова запроса ———

export type Query = { include: string[]; exclude: string[] };

const WORD = /[a-zа-яё0-9]+/gi;

/** «уголь поставка -ремонт "каменный уголь"» → слова и исключения; фраза в кавычках — одно слово из нескольких. */
export function parseQuery(text: string): Query {
  const include: string[] = [];
  const exclude: string[] = [];
  const re = /(-?)"([^"]+)"|(-?)(\S+)/g;
  for (const m of text.toLowerCase().matchAll(re)) {
    const minus = (m[1] ?? m[3]) === "-";
    const raw = (m[2] ?? m[4] ?? "").trim();
    const parts = raw.match(WORD);
    if (!parts) continue;
    (minus ? exclude : include).push(parts.join(" "));
  }
  return { include, exclude };
}

/** Основа слова: у русских слов отбрасываем окончание (до двух знаков), чтобы «поставка» находила «поставке», «поставку»; короткие слова (до четырёх знаков) — как есть. */
const stemOf = (word: string): string => (word.length <= 4 ? word : word.slice(0, Math.max(4, word.length - 2)));

/** Основы слова: обычная и, у слов на «-ль/-нь/-рь» с гласной «о/е» перед согласной, ещё без этой гласной («уголь» → «угол» и «угл»: «угля», «углю»; «день» → «дн»). */
function stemsOf(word: string): string[] {
  const out = [stemOf(word)];
  const dropped = /^(.{2,}?)[ое]([бвгджзклмнпрстфхцчшщ])ь$/.exec(word);
  if (dropped) out.push(dropped[1] + dropped[2]);
  return out;
}

const wordsOf = (text: string): string[] => (text.toLowerCase().match(WORD) ?? []).map((w) => w.replace(/ё/g, "е"));

function matchesTerm(haystack: string[], joined: string, term: string): boolean {
  const parts = wordsOf(term);
  if (parts.length === 0) return false;
  if (parts.length === 1) {
    const stems = stemsOf(parts[0]);
    return haystack.some((w) => stems.some((s) => w.startsWith(s)));
  }
  // Фраза: слова идут подряд, каждое — по основе.
  const all = parts.map(stemsOf);
  for (let i = 0; i + all.length <= haystack.length; i++) if (all.every((stems, k) => stems.some((s) => haystack[i + k].startsWith(s)))) return true;
  return joined.includes(parts.join(" "));
}

const includesText = (value: string | null, needle: string): boolean => !needle.trim() || (value ?? "").toLowerCase().replace(/ё/g, "е").includes(needle.trim().toLowerCase().replace(/ё/g, "е"));

// ——— Отбор ———

export type SearchResult = {
  items: TenderListing[];
  /** Сколько закупок было в выгрузке. */
  total: number;
  /** Скрыто из-за фильтра по цене: в выгрузке цены нет, проверить нельзя. */
  hiddenNoPrice: number;
  /** Скрыто из-за фильтра по дате размещения: даты нет. */
  hiddenNoDate: number;
};

export function searchTenders(listings: TenderListing[], filters: TenderFilters, sort: TenderSort, today: string): SearchResult {
  const q = parseQuery(filters.query);
  const hasPrice = filters.priceFrom !== null || filters.priceTo !== null;
  const hasPublished = Boolean(filters.publishedFrom || filters.publishedTo);
  let hiddenNoPrice = 0;
  let hiddenNoDate = 0;
  const items: TenderListing[] = [];
  for (const l of listings) {
    if (filters.law !== "any" && l.law !== (filters.law === "44" ? "44-ФЗ" : "223-ФЗ")) continue;
    if (q.include.length > 0 || q.exclude.length > 0) {
      const haystack = wordsOf(l.title);
      const joined = haystack.join(" ");
      if (filters.titleOnly && !q.include.every((t) => matchesTerm(haystack, joined, t))) continue;
      if (q.exclude.some((t) => matchesTerm(haystack, joined, t))) continue;
    }
    if (hasPrice) {
      if (l.price === null) {
        hiddenNoPrice++;
        continue;
      }
      if (filters.priceFrom !== null && l.price < filters.priceFrom) continue;
      if (filters.priceTo !== null && l.price > filters.priceTo) continue;
    }
    if (hasPublished) {
      if (!l.publishedAt) {
        hiddenNoDate++;
        continue;
      }
      if (filters.publishedFrom && l.publishedAt < filters.publishedFrom) continue;
      if (filters.publishedTo && l.publishedAt > filters.publishedTo) continue;
    }
    // Приём заявок идёт: окончание не раньше сегодня. Дата окончания не названа — закупку не прячем.
    if (filters.activeOnly && l.deadline && l.deadline < today) continue;
    if (!includesText(l.customer, filters.customer)) continue;
    if (!includesText(l.region, filters.region)) continue;
    if (!includesText(l.method, filters.method)) continue;
    items.push(l);
  }
  const far = "9999-99-99";
  const by: Record<TenderSort, (a: TenderListing, b: TenderListing) => number> = {
    deadline: (a, b) => (a.deadline ?? far).localeCompare(b.deadline ?? far),
    newest: (a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
    priceDesc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
    priceAsc: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  };
  items.sort(by[sort]);
  return { items, total: listings.length, hiddenNoPrice, hiddenNoDate };
}

// ——— Ссылки ———

/** ГГГГ-ММ-ДД → ДД.ММ.ГГГГ, как ждёт форма ЕИС. */
const ruDate = (iso: string): string => iso.split("-").reverse().join(".");

/**
 * Поиск закупок на zakupki.gov.ru с теми же словами, законом, ценой и датами: открывается в браузере участника, с нашего сервера в ЕИС ничего не уходит.
 * Названия параметров сверены 27.10.2026 с настоящей формой расширенного поиска и проверены поиском: searchString, morphology, fz44, fz223, af («Подача заявок»), priceFromGeneral, priceToGeneral,
 * currencyIdGeneral=-1 (любая валюта), publishDateFrom/To (размещено), applSubmissionCloseDateFrom (окончание подачи заявок не раньше), sortBy, sortDirection, recordsPerPage (_10, _20, _50), pageNumber.
 * Исключения слов («-слово») ЕИС в этой строке не понимает — они действуют у нас, в списке. Регион и способ в ссылку не кладутся: в форме ЕИС они выбираются справочником.
 */
export function eisOrdersUrl(filters: TenderFilters, today: string, page = 1): string {
  const q = parseQuery(filters.query);
  const words = q.include.map((t) => (t.includes(" ") ? '"' + t + '"' : t)).join(" ");
  const params: string[] = [
    "searchString=" + encodeURIComponent(words.slice(0, 200)),
    "morphology=on",
    ...(filters.law !== "223" ? ["fz44=on"] : []),
    ...(filters.law !== "44" ? ["fz223=on"] : []),
    ...(filters.activeOnly ? ["af=on"] : ["af=on", "ca=on", "pc=on", "pa=on"]),
    ...(filters.priceFrom !== null ? ["priceFromGeneral=" + Math.round(filters.priceFrom)] : []),
    ...(filters.priceTo !== null ? ["priceToGeneral=" + Math.round(filters.priceTo)] : []),
    ...(filters.priceFrom !== null || filters.priceTo !== null ? ["currencyIdGeneral=-1"] : []),
    ...(filters.publishedFrom ? ["publishDateFrom=" + ruDate(filters.publishedFrom)] : []),
    ...(filters.publishedTo ? ["publishDateTo=" + ruDate(filters.publishedTo)] : []),
    ...(filters.activeOnly ? ["applSubmissionCloseDateFrom=" + ruDate(today)] : []),
    "sortBy=UPDATE_DATE",
    "sortDirection=false",
    "recordsPerPage=_50",
    "pageNumber=" + page,
  ];
  return "https://zakupki.gov.ru/epz/order/extendedsearch/results.html?" + params.join("&");
}

/** Карточка закупки по номеру: поиск по реестровому номеру в обоих законах. */
export const eisNumberUrl = (id: string): string => `https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=${encodeURIComponent(id)}&morphology=on&fz44=on&fz223=on`;
