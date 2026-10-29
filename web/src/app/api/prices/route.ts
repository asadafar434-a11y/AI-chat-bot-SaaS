import { createAnthropic } from "@ai-sdk/anthropic";
import type { MastraModelConfig } from "@mastra/core/llm";
import Anthropic from "@anthropic-ai/sdk";
import { PRICES } from "@/lib/ai-cost";
import { appIdOf, BUDGET_TEXT, budgetOver, chargeAi, requireAiAuth } from "@/lib/ai-guard";
import { lookupDrugLimits } from "@/server/drug-prices/grls";
import { fetchHtml } from "@/server/market/fetch-page";
import { handlePrices } from "@/server/market/prices-handler";
import { createModelSearch, WEB_SEARCH_FEE_USD } from "@/server/market/model-search";
import { runPriceAgent } from "@/server/market/price-agent";
import { createSearcher } from "@/server/web-search/search";

// Живой поиск закупочных цен при разборе закупки. Платная часть — чтение страниц моделью: вызовы идут только при ключе модели на сервере, под бюджетом ИИ на закупку и потолком на запрос (PRICE_SEARCH_CAP_RUB, по умолчанию 30 ₽).
export const maxDuration = 300;

// Бесплатный поисковик (запасной): один на процесс, у него общая память на час и общий счёт запросов в минуту. С сервера его часто блокируют («подтвердите, что вы человек»).
const freeSearch = createSearcher();
// Основной поиск — встроенный поиск модели (платный, $0,01 за запрос плюс токены); PRICE_SEARCH_PROVIDER=free возвращает бесплатный.
const useModelSearch = process.env.PRICE_SEARCH_PROVIDER !== "free";
const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 1200;
const usdRub = Number(process.env.USD_RUB) || 0;
const capRub = Number(process.env.PRICE_SEARCH_CAP_RUB) || 30;
// Цены ищет агент на Mastra (server/market/price-agent.ts): на экзамене 29.10.2026 он нашёл 11 цен против 5 у обычного сбора за +5 ₽ (владелец: «да 1» — включить). PRICE_SEARCH_ENGINE=collect возвращает обычный сбор; модель агента — PRICE_AGENT_MODEL (по умолчанию та же, что у сбора).
const useAgent = process.env.PRICE_SEARCH_ENGINE !== "collect";
const AGENT_MODEL = process.env.PRICE_AGENT_MODEL || MODEL;

export async function POST(request: Request) {
  const prices = PRICES[MODEL];
  const appId = appIdOf(request);
  let searchUsd = 0;
  const modelSearch = createModelSearch(
    async (system, query) => {
      const res = await new Anthropic().messages.create({
        model: MODEL,
        max_tokens: 200,
        system,
        messages: [{ role: "user", content: query }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1, user_location: { type: "approximate", country: "RU" } }],
      });
      const fee = (res.usage.server_tool_use?.web_search_requests ?? 1) * WEB_SEARCH_FEE_USD;
      return { content: res.content, usd: chargeAi("prices-search", appId, { model: MODEL, usage: res.usage }, fee) };
    },
    (usd) => {
      searchUsd += usd;
    },
  );
  const search = async (query: string) => {
    if (useModelSearch) {
      try {
        return await modelSearch(query);
      } catch {
        // Встроенный поиск не ответил (не включён в аккаунте, сбой) — пробуем бесплатный.
      }
    }
    return (await freeSearch(query)).hits;
  };
  const searchSpent = () => searchUsd * usdRub;
  // Худший случай одного поиска: плата $0,01 плюс токены результатов (до ~12 тысяч входа) и короткий ответ.
  const searchWorstRub = useModelSearch ? (WEB_SEARCH_FEE_USD + (12_000 * prices.input + 200 * prices.output) / 1_000_000) * usdRub : 0;
  return handlePrices(request, {
    authorize: requireAiAuth,
    aiAvailable: () => Boolean(process.env.ANTHROPIC_API_KEY),
    budgetOver,
    appIdOf,
    search,
    searchSpent,
    searchWorstRub,
    maxQueries: useModelSearch ? 1 : undefined,
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
    pause: () => new Promise((resolve) => setTimeout(resolve, 1500)),
    registry: (position, day) => lookupDrugLimits(position.name, day),
    agent: useAgent
      ? ({ wanted, capRub: cap }) =>
          runPriceAgent(
            {
              // Модель AI SDK; Mastra держит свою копию описаний типов AI SDK, поэтому тип приводится явно (в работе это та же модель).
              model: createAnthropic()(AGENT_MODEL) as unknown as MastraModelConfig,
              search,
              fetchPage: (url) => fetchHtml(url),
              // Каждый шаг агента — в журнал расходов и в бюджет ИИ закупки.
              stepRub: ({ input, output }) => chargeAi("prices-agent", appId, { model: AGENT_MODEL, usage: { input_tokens: input, output_tokens: output } }) * usdRub,
              searchSpent,
              searchWorstRub,
              today: () => new Date().toISOString().slice(0, 10),
            },
            { wanted, capRub: cap },
          )
      : undefined,
  });
}
