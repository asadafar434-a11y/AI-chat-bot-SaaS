// Проверка гипотез о скрытых затратах обычным поиском в интернете (раздел «Аналитика»). Здесь — чистая часть: что можно отправить в поиск и как разобрать ответ; сам запрос — на сервере (server/web-search).
// Правила (решения владельца 21.10.2026 и 20.10.2026): в поиск уходят только ключевые слова — ни документов закупки, ни названия и реквизитов компании, ни почты и телефонов; результат всегда
// со ссылкой, датой поиска и меткой «Не проверено» — программа страницы не читает и чисел из них не берёт, проверяет человек. Пробный бесплатный поиск (DuckDuckGo) временный: боевой — российский
// поисковый сервис по ключу (решение владельца), его подключают к тому же интерфейсу.

export type SearchHit = { title: string; url: string; domain: string; snippet: string };

/** Что сохраняется по гипотезе: запрос, когда и чем искали, что нашлось. */
export type SearchRecord = { query: string; at: string; provider: string; hits: SearchHit[] };

export const MAX_HITS = 6;
export const MAX_QUERY = 160;
export const MIN_QUERY = 3;

export type ProviderId = "duckduckgo" | "brave";
export const PROVIDER_NAMES: Record<ProviderId, string> = { duckduckgo: "DuckDuckGo (пробный бесплатный поиск)", brave: "Brave Search (пробный бесплатный поиск)" };

export const braveUrl = (query: string) => `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
export const duckDuckGoUrl = (query: string) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=ru-ru`;

export type QueryCheck = { ok: true; query: string } | { ok: false; reason: string };

// В поиск идут только слова. Почта, адрес сайта и длинные числа (телефон, ИНН, счёт, номер извещения) в запрос не попадают — даже если их вписали руками.
export function cleanQuery(raw: unknown): QueryCheck {
  if (typeof raw !== "string") return { ok: false, reason: "Запрос для поиска пустой." };
  const query = raw.replace(/\s+/g, " ").trim();
  if (query.length < MIN_QUERY) return { ok: false, reason: "Запрос для поиска слишком короткий." };
  if (query.length > MAX_QUERY) return { ok: false, reason: `Запрос длиннее ${MAX_QUERY} знаков: оставьте ключевые слова.` };
  if (/@|https?:|www\.|\.(ru|com|org|net)\b/i.test(query)) return { ok: false, reason: "В запросе есть почта или адрес сайта — в поиск уходят только ключевые слова." };
  if (/\d{8,}/.test(query) || /(?:\+7|(?<!\d)8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/.test(query)) return { ok: false, reason: "В запросе длинное число (телефон, ИНН, номер) — в поиск уходят только ключевые слова." };
  return { ok: true, query };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…" };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
const plain = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// Ссылка в ответе DuckDuckGo — через их переадресацию («…/l/?uddg=настоящий адрес»). Берём настоящий; только http и https.
export function realUrl(href: string): string | null {
  const raw = decode(href).trim();
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    const target = url.hostname.endsWith("duckduckgo.com") && url.pathname.startsWith("/l/") ? url.searchParams.get("uddg") : url.toString();
    if (!target) return null;
    const final = new URL(target);
    return final.protocol === "http:" || final.protocol === "https:" ? final.toString() : null;
  } catch {
    return null;
  }
}

export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Результаты из страницы DuckDuckGo (html.duckduckgo.com/html): реклама отбрасывается, повторы по адресу убираются. */
export function parseDuckDuckGoHtml(html: string, limit = MAX_HITS): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const block of html.split(/<div class="result[ "]/).slice(1)) {
    if (/^[^>]*result--ad/.test(block)) continue;
    const link = /<a\b[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const href = /<a\b[^>]*class="result__a"[^>]*href="([^"]+)"/.exec(block) ?? /<a\b[^>]*href="([^"]+)"[^>]*class="result__a"/.exec(block);
    if (!link || !href) continue;
    const url = realUrl(href[1]);
    if (!url || /\/y\.js\?|duckduckgo\.com\/y\.js/.test(url) || seen.has(url)) continue;
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const title = plain(link[1]);
    if (!title) continue;
    seen.add(url);
    hits.push({ title: title.slice(0, 200), url, domain: domainOf(url), snippet: snippet ? plain(snippet[1]).slice(0, 400) : "" });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Результаты из страницы Brave Search (search.brave.com): блоки обычных результатов, первая внешняя ссылка, заголовок и описание; повторы по адресу убираются. */
export function parseBraveHtml(html: string, limit = MAX_HITS): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const block of html.split(/<div class="snippet[^"]*"[^>]*data-type="web"[^>]*>/).slice(1)) {
    const href = /<a\b[^>]*href="(https?:\/\/[^"]+)"/.exec(block);
    if (!href) continue;
    const url = realUrl(href[1]);
    if (!url || /(?:^|\.)brave\.com$/.test(domainOf(url)) || seen.has(url)) continue;
    const title = /<div class="title[ "][^>]*>([\s\S]*?)<\/div>/.exec(block);
    const description = /<div class="content[ "][^>]*>([\s\S]*?)<\/div>/.exec(block);
    const text = title ? plain(title[1]) : "";
    if (!text) continue;
    seen.add(url);
    hits.push({ title: text.slice(0, 200), url, domain: domainOf(url), snippet: description ? plain(description[1]).slice(0, 400) : "" });
    if (hits.length >= limit) break;
  }
  return hits;
}

const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");

/** Сохранённые поиски из хранилища: берём только понятное, ссылки — только http и https, не больше шести результатов на запрос. */
export function normalizeSearches(raw: unknown): Record<string, SearchRecord> {
  const out: Record<string, SearchRecord> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const hits = (Array.isArray(v.hits) ? (v.hits as unknown[]) : []).flatMap((h): SearchHit[] => {
      if (!h || typeof h !== "object") return [];
      const hit = h as Record<string, unknown>;
      const url = typeof hit.url === "string" && /^https?:\/\//i.test(hit.url) ? hit.url.slice(0, 600) : "";
      return url ? [{ title: str(hit.title, 200), url, domain: domainOf(url), snippet: str(hit.snippet, 400) }] : [];
    });
    const query = str(v.query, MAX_QUERY);
    if (query) out[id.slice(0, 60)] = { query, at: str(v.at, 40), provider: str(v.provider, 80), hits: hits.slice(0, MAX_HITS) };
  }
  return out;
}
