import "server-only";
import type { RateKind, RateObservation } from "@/lib/rate-extract";
import { parseRatesRequest, rateQueries } from "@/lib/rates-request";
import { badRequest, readJson } from "@/lib/read-json";
import { moscowDay } from "@/lib/registry-types";
import type { CollectDeps } from "@/server/market/collect";
import { collectRates } from "@/server/rates/collect-rates";

// «Найти зарплаты и аренду техники в интернете по составу исполнения» (/api/rates): при открытии аналитики, без кнопки, небольшими порциями. По каждой позиции — поиск, чтение страниц платной моделью, проверка кода (lib/rate-extract.ts).
// Расходы ограничены так же, как у поиска цен: потолок на запрос в рублях (перед каждым вызовом модели считается худший случай), бюджет ИИ на закупку (ai-guard) и лимиты на частоту запросов (proxy.ts).
// Отдельно от файла маршрута, чтобы проверять без сети и денег: поиск, скачивание, модель и бюджет подставляются.

export type RatesDeps = {
  authorize: (request: Request) => Promise<Response | null>;
  aiAvailable: () => boolean;
  budgetOver: (appId: string | null) => Promise<boolean>;
  appIdOf: (request: Request) => string | null;
  search: CollectDeps["search"];
  fetchPage: CollectDeps["fetchPage"];
  ask: (system: string, user: string, appId: string | null) => Promise<{ text: string; usd: number }>;
  worstCaseRub: CollectDeps["worstCaseRub"];
  usdRub: number;
  /** Потолок расходов на один запрос, ₽. */
  capRub: number;
  budgetText: string;
  now?: () => Date;
  pause?: () => Promise<void>;
  /** Зарплата по открытым вакансиям региона (бесплатно, без модели): нашлась — поиск по сайтам для этой должности не нужен. */
  official?: (item: { subject: string; region: string | null }, day: string) => Promise<RateObservation | null>;
};

// pagesRead — страниц, которые прочитала модель; pagesSeen — всего просмотрено; pagesWithNumbers — на скольких вообще были цифры с ₽; onRequest — «цена по запросу»; reasons — почему отклонены записи.
export type RateItemResult = { key: string; kind: RateKind; observations: RateObservation[]; pagesRead: number; pagesSeen: number; pagesWithNumbers: number; onRequest: number; rejected: number; reasons: string[] };

const plain = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const MAX_PAGES = 3;
const MAX_CANDIDATES = 8;

export async function handleRates(request: Request, deps: RatesDeps): Promise<Response> {
  const denied = await deps.authorize(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return badRequest();
  const parsed = parseRatesRequest(body);
  if (!parsed.ok) return plain(parsed.error, 400);
  if (!deps.aiAvailable()) return plain("ИИ на сервере выключен: зарплаты и аренда в интернете не искались.", 503);
  if (!(deps.usdRub > 0)) return plain("Курс доллара не задан на сервере (USD_RUB): стоимость поиска не посчитать, поэтому он не запускается.", 503);
  const appId = deps.appIdOf(request);
  if (await deps.budgetOver(appId)) return plain(deps.budgetText, 402);

  const now = deps.now?.() ?? new Date();
  const day = moscowDay(now.toISOString());
  const items = parsed.value.items;
  const perItem = deps.capRub / items.length;
  const results: RateItemResult[] = [];
  const errors = new Set<string>();
  let spentRub = 0;
  let stopped = false;
  for (const item of items) {
    // Зарплата из открытых данных «Работа в России»: платная модель и поиск по сайтам не нужны.
    if (item.kind === "salary") {
      const official = await deps.official?.(item, day).catch(() => null);
      if (official) {
        results.push({ key: item.key, kind: item.kind, observations: [official], pagesRead: 0, pagesSeen: 1, pagesWithNumbers: 1, onRequest: 0, rejected: 0, reasons: [] });
        continue;
      }
    }
    if (results.length > 0) await deps.pause?.();
    const queries = rateQueries(item, Number(day.slice(0, 4)));
    if (queries.length === 0) {
      results.push({ key: item.key, kind: item.kind, observations: [], pagesRead: 0, pagesSeen: 0, pagesWithNumbers: 0, onRequest: 0, rejected: 0, reasons: [] });
      continue;
    }
    const r = await collectRates(
      { search: deps.search, fetchPage: deps.fetchPage, ask: (system, user) => deps.ask(system, user, appId), worstCaseRub: deps.worstCaseRub, usdRub: deps.usdRub, today: () => day, pause: deps.pause },
      { wanted: { kind: item.kind, subject: item.subject, region: item.region }, queries, maxPages: MAX_PAGES, maxCandidates: MAX_CANDIDATES, capRub: Math.min(perItem * 2, deps.capRub - spentRub) },
    );
    spentRub = Math.round((spentRub + r.spentRub) * 100) / 100;
    for (const e of r.searchErrors) errors.add(/подтвердить, что вы человек|не отвечает/.test(e) ? "поиск не ответил (просит подтвердить, что вы человек)" : "поиск не удался");
    results.push({
      key: item.key,
      kind: item.kind,
      observations: r.accepted,
      pagesRead: r.pages.filter((p) => p.status === "read").length,
      pagesSeen: r.pages.length,
      pagesWithNumbers: r.pages.filter((p) => p.status === "read" || p.skipReason?.startsWith("модель не ответила")).length,
      onRequest: r.pages.filter((p) => p.skipReason === "цена по запросу").length,
      rejected: r.rejected.length,
      reasons: [...new Set(r.rejected.map((x) => x.reason))],
    });
    if (r.stoppedByCap || deps.capRub - spentRub <= 0) {
      stopped = true;
      break;
    }
  }
  for (const item of items) if (!results.some((r) => r.key === item.key)) results.push({ key: item.key, kind: item.kind, observations: [], pagesRead: 0, pagesSeen: 0, pagesWithNumbers: 0, onRequest: 0, rejected: 0, reasons: [] });
  return Response.json({ asOf: day, spentRub, stoppedByCap: stopped, searchErrors: [...errors], results });
}
