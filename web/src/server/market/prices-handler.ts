import "server-only";
import type { Observation } from "@/lib/market-observations";
import { parsePricesRequest, searchQueriesFor } from "@/lib/prices-request";
import { badRequest, readJson } from "@/lib/read-json";
import { moscowDay } from "@/lib/registry-types";
import { collectPrices, type CollectDeps } from "@/server/market/collect";

// «Найти закупочные цены в интернете по позициям закупки» (/api/prices): без кнопки, при открытии аналитики. По каждой позиции — поиск, чтение страниц платной моделью, проверка кода (lib/price-extract.ts).
// Расходы ограничены тремя способами: потолок на запрос в рублях (перед каждым вызовом модели считается худший случай), бюджет ИИ на закупку (ai-guard) и лимиты на частоту запросов (proxy.ts).
// Отдельно от файла маршрута, чтобы проверять без сети и денег: поиск, скачивание, модель и бюджет подставляются.

export type PricesDeps = {
  authorize: (request: Request) => Promise<Response | null>;
  /** Есть ли на сервере ключ модели: нет — ИИ выключен, ничего не ищем. */
  aiAvailable: () => boolean;
  /** Бюджет ИИ на эту закупку исчерпан. */
  budgetOver: (appId: string | null) => Promise<boolean>;
  appIdOf: (request: Request) => string | null;
  search: CollectDeps["search"];
  fetchPage: CollectDeps["fetchPage"];
  /** Один вызов модели; расход записывается в журнал и в бюджет закупки внутри. */
  ask: (system: string, user: string, appId: string | null) => Promise<{ text: string; usd: number }>;
  worstCaseRub: CollectDeps["worstCaseRub"];
  usdRub: number;
  /** Потолок расходов на один запрос, ₽. */
  capRub: number;
  budgetText: string;
  now?: () => Date;
};

export type PricePositionResult = { key: string; observations: Observation[]; pagesRead: number; rejected: number };

const plain = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const MAX_PAGES = 4;

export async function handlePrices(request: Request, deps: PricesDeps): Promise<Response> {
  const denied = await deps.authorize(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest();
  const parsed = parsePricesRequest(body);
  if (!parsed.ok) return plain(parsed.error, 400);
  if (!deps.aiAvailable()) return plain("ИИ на сервере выключен: закупочные цены в интернете не искались.", 503);
  if (!(deps.usdRub > 0)) return plain("Курс доллара не задан на сервере (USD_RUB): стоимость поиска не посчитать, поэтому он не запускается.", 503);
  const appId = deps.appIdOf(request);
  if (await deps.budgetOver(appId)) return plain(deps.budgetText, 402);

  const now = deps.now?.() ?? new Date();
  const day = moscowDay(now.toISOString());
  const positions = parsed.value.positions;
  const perPosition = deps.capRub / positions.length;
  const results: PricePositionResult[] = [];
  const errors = new Set<string>();
  let spentRub = 0;
  let stopped = false;
  for (const p of positions) {
    const queries = searchQueriesFor(p);
    if (queries.length === 0) {
      results.push({ key: p.key, observations: [], pagesRead: 0, rejected: 0 });
      continue;
    }
    const r = await collectPrices(
      {
        search: deps.search,
        fetchPage: deps.fetchPage,
        ask: (system, user) => deps.ask(system, user, appId),
        worstCaseRub: deps.worstCaseRub,
        usdRub: deps.usdRub,
        today: () => day,
      },
      // Остаток потолка переходит дальше: что не потратила одна позиция, может потратить другая, но общий потолок не превышается.
      { wanted: { name: p.name, unit: p.unit, region: p.region }, queries, maxPages: MAX_PAGES, capRub: Math.min(perPosition * 2, deps.capRub - spentRub) },
    );
    spentRub = Math.round((spentRub + r.spentRub) * 100) / 100;
    for (const e of r.searchErrors) errors.add(/подтвердить, что вы человек|не отвечает/.test(e) ? "поиск не ответил (просит подтвердить, что вы человек)" : "поиск не удался");
    results.push({ key: p.key, observations: r.accepted, pagesRead: r.pages.filter((x) => x.status === "read").length, rejected: r.rejected.length });
    if (r.stoppedByCap || deps.capRub - spentRub <= 0) {
      stopped = true;
      break;
    }
  }
  for (const p of positions) if (!results.some((r) => r.key === p.key)) results.push({ key: p.key, observations: [], pagesRead: 0, rejected: 0 });
  return Response.json({ asOf: day, spentRub, stoppedByCap: stopped, searchErrors: [...errors], results });
}
