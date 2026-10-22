import Anthropic from "@anthropic-ai/sdk";
import { PRICES } from "@/lib/ai-cost";
import { appIdOf, BUDGET_TEXT, budgetOver, chargeAi, requireAiAuth } from "@/lib/ai-guard";
import { fetchHtml } from "@/server/market/fetch-page";
import { handlePrices } from "@/server/market/prices-handler";
import { createSearcher } from "@/server/web-search/search";

// Живой поиск закупочных цен при разборе закупки. Платная часть — чтение страниц моделью: вызовы идут только при ключе модели на сервере, под бюджетом ИИ на закупку и потолком на запрос (PRICE_SEARCH_CAP_RUB, по умолчанию 30 ₽).
export const maxDuration = 120;

// Один поисковик на процесс: у него общая память на час и общий счёт запросов в минуту.
const search = createSearcher();
const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 1200;
const usdRub = Number(process.env.USD_RUB) || 0;
const capRub = Number(process.env.PRICE_SEARCH_CAP_RUB) || 30;

export async function POST(request: Request) {
  const prices = PRICES[MODEL];
  return handlePrices(request, {
    authorize: requireAiAuth,
    aiAvailable: () => Boolean(process.env.ANTHROPIC_API_KEY),
    budgetOver,
    appIdOf,
    search: async (query) => (await search(query)).hits,
    fetchPage: (url) => fetchHtml(url),
    ask: async (system, user, appId) => {
      const res = await new Anthropic().messages.create({ model: MODEL, max_tokens: MAX_TOKENS, system, messages: [{ role: "user", content: user }] });
      const usd = chargeAi("prices", appId, { model: MODEL, usage: res.usage });
      return { text: res.content.map((b) => (b.type === "text" ? b.text : "")).join(""), usd };
    },
    // Худший случай одного вызова: вход по длине (не больше 2,2 знака на токен), выход — по максимуму.
    worstCaseRub: (chars) => (((chars / 2.2) * prices.input + MAX_TOKENS * prices.output) / 1_000_000) * usdRub,
    usdRub,
    capRub,
    budgetText: BUDGET_TEXT,
  });
}
