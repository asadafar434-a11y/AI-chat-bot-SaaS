import { buildUserPrompt, checkOffer, parseModelAnswer, SYSTEM_PROMPT, type Checked, type Wanted } from "../../lib/price-extract.ts";
import type { Observation } from "../../lib/market-observations.ts";
import { priceExcerpt } from "../../lib/page-text.ts";
import type { PageFetch } from "./fetch-page.ts";

// Сбор закупочных цен со страниц поставщиков: поиск (бесплатный) находит страницы, по одной странице с сайта скачивается и читается моделью, ответ проверяет код (lib/price-extract.ts).
// Платная часть — только вызовы модели, и они жёстко ограничены потолком в рублях: перед каждым вызовом считается худший случай, и если он выходит за потолок, сбор останавливается.
// Все внешние действия (поиск, скачивание, модель) подставляются: так сбор проверяется тестами без сети и без денег.

export type SearchHit = { title: string; url: string; domain: string; snippet: string };

export type CollectDeps = {
  search: (query: string) => Promise<SearchHit[]>;
  fetchPage: (url: string) => Promise<PageFetch>;
  /** Один вызов модели: текст ответа и стоимость в долларах (из usage ответа). */
  ask: (system: string, user: string) => Promise<{ text: string; usd: number }>;
  /** Худшая стоимость одного вызова в рублях по длине задания: вход по длине, выход — по максимуму. */
  worstCaseRub: (promptChars: number) => number;
  usdRub: number;
  today: () => string;
};

export type CollectOptions = { wanted: Wanted; queries: string[]; maxPages: number; capRub: number };

export type PageOutcome = {
  url: string;
  domain: string;
  title: string;
  status: "read" | "skipped";
  skipReason?: string;
  chars?: number;
  costRub?: number;
  offers: Checked[];
};

export type CollectResult = {
  pages: PageOutcome[];
  accepted: Observation[];
  rejected: { url: string; reason: string; detail?: string; quote: string; price: number; product: string }[];
  spentRub: number;
  calls: number;
  stoppedByCap: boolean;
  searchErrors: string[];
};

// Сайты, на которых нет закупочных цен поставщиков: видео, соцсети, энциклопедии, поисковики, новости и биржевые обзоры.
const SKIP_DOMAINS = /(^|\.)(youtube\.com|youtu\.be|vk\.com|ok\.ru|dzen\.ru|wikipedia\.org|yandex\.ru|google\.com|tradingeconomics\.com|tiktok\.com|instagram\.com|facebook\.com|t\.me|avito\.ru|youla\.ru)$/i;

export async function collectPrices(deps: CollectDeps, options: CollectOptions): Promise<CollectResult> {
  const result: CollectResult = { pages: [], accepted: [], rejected: [], spentRub: 0, calls: 0, stoppedByCap: false, searchErrors: [] };
  const found: SearchHit[][] = [];
  for (const query of options.queries) {
    try {
      found.push(await deps.search(query));
    } catch (e) {
      result.searchErrors.push(`${query}: ${e instanceof Error ? e.message.slice(0, 120) : "поиск не ответил"}`);
      found.push([]);
    }
  }
  // Страницы по очереди из каждого запроса, по одной с сайта.
  const picked: SearchHit[] = [];
  const domains = new Set<string>();
  for (let i = 0; picked.length < options.maxPages && found.some((list) => i < list.length); i++) {
    for (const list of found) {
      const hit = list[i];
      if (!hit || picked.length >= options.maxPages) continue;
      const domain = hit.domain.replace(/^www\./, "").toLowerCase();
      if (domains.has(domain) || SKIP_DOMAINS.test(domain)) continue;
      domains.add(domain);
      picked.push({ ...hit, domain });
    }
  }

  const day = deps.today();
  const seen = new Set<string>();
  for (const hit of picked) {
    const outcome: PageOutcome = { url: hit.url, domain: hit.domain, title: hit.title, status: "skipped", offers: [] };
    result.pages.push(outcome);
    const page = await deps.fetchPage(hit.url);
    if (!page.ok) {
      outcome.skipReason = page.error;
      continue;
    }
    const excerpt = priceExcerpt(page.html);
    if (excerpt.text.length < 80) {
      outcome.skipReason = "на странице почти нет текста";
      continue;
    }
    const user = buildUserPrompt(options.wanted, { url: page.finalUrl, title: excerpt.title || hit.title, text: excerpt.text });
    outcome.chars = excerpt.text.length;
    if (result.spentRub + deps.worstCaseRub(SYSTEM_PROMPT.length + user.length) > options.capRub) {
      result.stoppedByCap = true;
      outcome.skipReason = "остановлено: следующий вызов мог выйти за потолок расходов";
      break;
    }
    let answer: { text: string; usd: number };
    try {
      answer = await deps.ask(SYSTEM_PROMPT, user);
    } catch (e) {
      outcome.skipReason = `модель не ответила: ${e instanceof Error ? e.message.slice(0, 120) : "ошибка"}`;
      continue;
    }
    result.calls++;
    outcome.status = "read";
    outcome.costRub = Math.round(answer.usd * deps.usdRub * 100) / 100;
    result.spentRub = Math.round((result.spentRub + answer.usd * deps.usdRub) * 100) / 100;
    for (const offer of parseModelAnswer(answer.text)) {
      const checked = checkOffer(offer, excerpt.text, options.wanted, { url: page.finalUrl, title: excerpt.title || hit.title, day });
      outcome.offers.push(checked);
      if (checked.ok) {
        if (!seen.has(checked.observation.hash)) {
          seen.add(checked.observation.hash);
          result.accepted.push(checked.observation);
        }
      } else {
        result.rejected.push({ url: page.finalUrl, reason: checked.reason, detail: checked.detail, quote: offer.quote, price: offer.price, product: offer.product });
      }
    }
  }
  return result;
}
