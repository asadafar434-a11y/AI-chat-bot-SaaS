import "server-only";
import type { Observation } from "@/lib/market-observations";
import type { Wanted } from "@/lib/price-extract";
import { parsePricesRequest, searchQueriesFor, type PricePosition } from "@/lib/prices-request";
import { badRequest, readJson } from "@/lib/read-json";
import { moscowDay } from "@/lib/registry-types";
import { collectPrices, type CollectDeps, type CollectResult } from "@/server/market/collect";

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
  /** Пауза между запросами к бесплатному поиску (см. CollectDeps.pause). */
  pause?: () => Promise<void>;
  /** Поиск платный (встроенный поиск модели): сколько рублей он уже потратил в этом запросе — идёт в общий потолок. Бесплатному поиску не нужен. */
  searchSpent?: () => number;
  /** Худший расход одного поискового запроса, ₽: перед позицией столько оставляется в потолке на поиск. */
  searchWorstRub?: number;
  /** Сколько запросов в поиск на позицию (платный поиск — один; бесплатный — все). */
  maxQueries?: number;
  /** Пилот: поиск цен агентом (server/market/price-agent.ts) вместо обычного сбора — та же проверка цен кодом и тот же потолок; нет — обычный сбор. */
  agent?: (options: { wanted: Wanted; capRub: number }) => Promise<CollectResult>;
  /** Официальный источник цен по позиции, если он есть (реестр предельных цен на лекарства): бесплатно и без модели. null или пусто — не лекарство или в реестре нет, идёт обычный поиск. */
  registry?: (position: PricePosition, day: string) => Promise<Observation[] | null>;
};

// pagesRead — страниц, которые прочитала модель; pagesSeen — всего просмотрено; pagesWithPrice — на скольких из них вообще нашлось что-то похожее на цену (остальные модели не отправляются); reasons — почему отклонены предложения.
export type PricePositionResult = { key: string; observations: Observation[]; pagesRead: number; rejected: number; pagesSeen?: number; pagesWithPrice?: number; onRequest?: number; reasons?: string[] };

const plain = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
// Страниц читает модель — не больше пяти на позицию; просматривается до десяти (бесплатно), чтобы выбрать те, где есть цена.
const MAX_PAGES = 5;
const MAX_CANDIDATES = 10;

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
  // Расход на чтение страниц и на платный поиск вместе: потолок общий.
  const totalSpent = () => Math.round((spentRub + (deps.searchSpent?.() ?? 0)) * 100) / 100;
  for (const p of positions) {
    // Лекарство из реестра предельных цен: официальные цены с датой решения, платный поиск по сайтам не нужен.
    const official = await deps.registry?.(p, day).catch(() => null);
    if (official && official.length > 0) {
      results.push({ key: p.key, observations: official, pagesRead: 0, rejected: 0, pagesSeen: 1, pagesWithPrice: 1 });
      continue;
    }
    if (results.length > 0) await deps.pause?.();
    const queries = searchQueriesFor(p).slice(0, deps.maxQueries ?? Infinity);
    if (queries.length === 0) {
      results.push({ key: p.key, observations: [], pagesRead: 0, rejected: 0 });
      continue;
    }
    // Платный поиск: если в потолке не осталось места даже на сам поиск — позицию не начинаем.
    const searchReserve = (deps.searchWorstRub ?? 0) * queries.length;
    if (deps.capRub - totalSpent() < searchReserve) {
      stopped = true;
      break;
    }
    const wanted = { name: p.name, unit: p.unit, region: p.region };
    // Остаток потолка переходит дальше: что не потратила одна позиция, может потратить другая, но общий потолок не превышается.
    const positionCap = Math.min(perPosition * 2, deps.capRub - totalSpent() - searchReserve);
    const r = deps.agent
      ? await deps.agent({ wanted, capRub: positionCap })
      : await collectPrices(
          {
            search: deps.search,
            fetchPage: deps.fetchPage,
            ask: (system, user) => deps.ask(system, user, appId),
            worstCaseRub: deps.worstCaseRub,
            usdRub: deps.usdRub,
            today: () => day,
            pause: deps.pause,
          },
          { wanted, queries, maxPages: MAX_PAGES, maxCandidates: MAX_CANDIDATES, capRub: positionCap },
        );
    spentRub = Math.round((spentRub + r.spentRub) * 100) / 100;
    for (const e of r.searchErrors) errors.add(/подтвердить, что вы человек|не отвечает/.test(e) ? "поиск не ответил (просит подтвердить, что вы человек)" : "поиск не удался");
    results.push({
      key: p.key,
      observations: r.accepted,
      pagesRead: r.pages.filter((x) => x.status === "read").length,
      rejected: r.rejected.length,
      pagesSeen: r.pages.length,
      pagesWithPrice: r.pages.filter((x) => x.status === "read" || x.skipReason?.startsWith("модель не ответила")).length,
      onRequest: r.pages.filter((x) => x.skipReason === "цена по запросу").length,
      reasons: [...new Set(r.rejected.map((x) => x.reason))],
    });
    if (r.stoppedByCap || deps.capRub - totalSpent() <= 0) {
      stopped = true;
      break;
    }
  }
  for (const p of positions) if (!results.some((r) => r.key === p.key)) results.push({ key: p.key, observations: [], pagesRead: 0, rejected: 0 });
  return Response.json({ asOf: day, spentRub: totalSpent(), stoppedByCap: stopped, searchErrors: [...errors], results });
}
