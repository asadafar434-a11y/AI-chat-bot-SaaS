import { checkRate, buildRatePrompt, parseRateAnswer, RATE_SYSTEM_PROMPT, type CheckedRate, type RateObservation, type RateWanted } from "../../lib/rate-extract.ts";
import { priceExcerpt } from "../../lib/page-text.ts";
import { hasPriceLike, saysPriceOnRequest, type CollectDeps, type SearchHit } from "../market/collect.ts";

// Сбор зарплат и аренды техники: поиск (бесплатный) находит страницы, по одной с сайта читается моделью, ответ проверяет код (lib/rate-extract.ts). Платная часть — только вызовы модели под потолком в рублях:
// перед каждым вызовом считается худший случай, и если он выходит за потолок, сбор останавливается. Устройство — то же, что у сбора закупочных цен (server/market/collect.ts).

export type RateCollectOptions = { wanted: RateWanted; queries: string[]; maxPages: number; maxCandidates?: number; capRub: number };

export type RatePage = { url: string; domain: string; title: string; status: "read" | "skipped"; skipReason?: string; costRub?: number; offers: CheckedRate[] };
export type RateCollectResult = {
  pages: RatePage[];
  accepted: RateObservation[];
  rejected: { url: string; reason: string; detail?: string; quote: string }[];
  spentRub: number;
  calls: number;
  stoppedByCap: boolean;
  searchErrors: string[];
};

// Сайты, на которых зарплат и цен аренды искать нечего: видео, соцсети, энциклопедии, поисковики, объявления физлиц (их не читаем).
const SKIP_DOMAINS = /(^|\.)(youtube\.com|youtu\.be|vk\.com|ok\.ru|dzen\.ru|wikipedia\.org|yandex\.ru|google\.com|tiktok\.com|instagram\.com|facebook\.com|t\.me|avito\.ru|youla\.ru)$/i;

export async function collectRates(deps: CollectDeps, options: RateCollectOptions): Promise<RateCollectResult> {
  const result: RateCollectResult = { pages: [], accepted: [], rejected: [], spentRub: 0, calls: 0, stoppedByCap: false, searchErrors: [] };
  const found: SearchHit[][] = [];
  for (const query of options.queries) {
    if (found.length > 0) await deps.pause?.();
    try {
      found.push(await deps.search(query));
    } catch (e) {
      result.searchErrors.push(`${query}: ${e instanceof Error ? e.message.slice(0, 120) : "поиск не ответил"}`);
      found.push([]);
    }
  }
  const picked: SearchHit[] = [];
  const domains = new Set<string>();
  const maxCandidates = Math.max(options.maxCandidates ?? options.maxPages, options.maxPages);
  for (let i = 0; picked.length < maxCandidates && found.some((list) => i < list.length); i++) {
    for (const list of found) {
      const hit = list[i];
      if (!hit || picked.length >= maxCandidates) continue;
      const domain = hit.domain.replace(/^www\./, "").toLowerCase();
      if (domains.has(domain) || SKIP_DOMAINS.test(domain)) continue;
      domains.add(domain);
      picked.push({ ...hit, domain });
    }
  }

  const day = deps.today();
  const seen = new Set<string>();
  for (const hit of picked) {
    if (result.calls >= options.maxPages) break;
    const outcome: RatePage = { url: hit.url, domain: hit.domain, title: hit.title, status: "skipped", offers: [] };
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
    if (!hasPriceLike(excerpt.text)) {
      outcome.skipReason = saysPriceOnRequest(excerpt.text) ? "цена по запросу" : "на странице нет цифр";
      continue;
    }
    const user = buildRatePrompt(options.wanted, { url: page.finalUrl, title: excerpt.title || hit.title, text: excerpt.text });
    if (result.spentRub + deps.worstCaseRub(RATE_SYSTEM_PROMPT.length + user.length) > options.capRub) {
      result.stoppedByCap = true;
      outcome.skipReason = "остановлено: следующий вызов мог выйти за потолок расходов";
      break;
    }
    let answer: { text: string; usd: number };
    try {
      answer = await deps.ask(RATE_SYSTEM_PROMPT, user);
    } catch (e) {
      outcome.skipReason = `модель не ответила: ${e instanceof Error ? e.message.slice(0, 120) : "ошибка"}`;
      continue;
    }
    result.calls++;
    outcome.status = "read";
    outcome.costRub = Math.round(answer.usd * deps.usdRub * 100) / 100;
    result.spentRub = Math.round((result.spentRub + answer.usd * deps.usdRub) * 100) / 100;
    for (const raw of parseRateAnswer(answer.text)) {
      const checked = checkRate(raw, excerpt.text, options.wanted, { url: page.finalUrl, title: excerpt.title || hit.title, day });
      outcome.offers.push(checked);
      if (checked.ok) {
        const key = `${checked.observation.host}|${checked.observation.monthly}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.accepted.push(checked.observation);
        }
      } else result.rejected.push({ url: page.finalUrl, reason: checked.reason, detail: checked.detail, quote: raw.quote });
    }
  }
  return result;
}
