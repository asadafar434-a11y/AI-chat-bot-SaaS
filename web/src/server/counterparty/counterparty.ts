import "server-only";
import {
  buildReport,
  latestBoReport,
  parseBoDetails,
  parseBoSearch,
  parseEgrul,
  parseFedresurs,
  SOURCE_NAMES,
  type BoOrganization,
  type CounterpartyReport,
  type FedresursInfo,
  type Identity,
  type SourceId,
  type SourceState,
  type Statement,
} from "@/lib/counterparty";

// Проверка контрагента по ИНН: сервер спрашивает три открытых реестра, участнику уходит готовый отчёт. В реестры уходит только ИНН — больше ничего от участника.
// Реестры отдают данные без входа и без капчи; если какой-то просит проверочное слово или молчит — это видно в отчёте (sources), капчу программа не обходит.
// Ответ держится в памяти шесть часов; запросов к реестрам — не больше десяти в минуту на процесс (общий адрес сервера не должен долбить государственные сайты).

export class CounterpartyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type CounterpartyOptions = { fetcher?: typeof fetch; now?: () => number; ttlMs?: number; timeoutMs?: number; maxPerMinute?: number };

// Реестры отвечают браузерам; приходим как скромный клиент и называем себя.
// Заголовок — только латиница: русские буквы в значении заголовка fetch не принимает.
const USER_AGENT = "Mozilla/5.0 (compatible; TenderLawyer/1.0; counterparty-check)";

class SourceError extends Error {}

const failureOf = (error: unknown): string => (error instanceof SourceError ? error.message : error instanceof Error && error.name === "TimeoutError" ? "не ответил вовремя" : "не ответил");

export function createCounterpartyLoader(options: CounterpartyOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? 6 * 60 * 60 * 1000;
  const timeout = options.timeoutMs ?? 10_000;
  const maxPerMinute = options.maxPerMinute ?? 10;
  const cache = new Map<string, { at: number; report: CounterpartyReport }>();
  const recent: number[] = [];

  async function call(url: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeout), headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(init.headers as Record<string, string> | undefined) } });
    if (response.status === 429 || response.status === 403 || response.status === 451) throw new SourceError("отказал в доступе (просит подождать)");
    if (!response.ok) throw new SourceError(`ответил ошибкой ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new SourceError("вернул непонятный ответ");
    }
  }

  async function egrul(inn: string): Promise<Identity | null> {
    const started = (await call("https://egrul.nalog.ru/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: new URLSearchParams({ vyp3CaptchaToken: "", page: "", query: inn, region: "", PreventChromeAutocomplete: "" }),
    })) as { t?: unknown; captchaRequired?: unknown };
    if (started.captchaRequired) throw new SourceError("просит ввести проверочное слово — повторите позже");
    if (typeof started.t !== "string" || !/^[0-9A-Fa-f]{20,}$/.test(started.t)) throw new SourceError("не принял запрос");
    return parseEgrul(await call(`https://egrul.nalog.ru/search-result/${started.t}`), inn);
  }

  async function fedresurs(inn: string): Promise<FedresursInfo | null> {
    return parseFedresurs(await call(`https://fedresurs.ru/backend/companies?limit=5&offset=0&searchString=${inn}`, { headers: { Referer: "https://fedresurs.ru/search/entity" } }), inn);
  }

  async function bo(inn: string): Promise<{ org: BoOrganization | null; statements: Statement[] }> {
    const org = parseBoSearch(await call(`https://bo.nalog.gov.ru/advanced-search/organizations/search?query=${inn}&page=0&size=5`), inn);
    if (!org) return { org: null, statements: [] };
    const latest = latestBoReport(await call(`https://bo.nalog.gov.ru/nbo/organizations/${org.id}/bfo/`));
    if (!latest) return { org, statements: [] };
    return { org, statements: parseBoDetails(await call(`https://bo.nalog.gov.ru/nbo/bfo/${latest.id}/details`), latest.period) };
  }

  return async function load(inn: string): Promise<CounterpartyReport & { cached: boolean }> {
    const saved = cache.get(inn);
    if (saved && now() - saved.at < ttl) return { ...saved.report, cached: true };
    while (recent.length > 0 && now() - recent[0] > 60_000) recent.shift();
    if (recent.length >= maxPerMinute) throw new CounterpartyError("Слишком много проверок подряд — реестры этого не любят. Повторите через минуту.", 429);
    recent.push(now());

    const [e, f, b] = await Promise.allSettled([egrul(inn), fedresurs(inn), bo(inn)]);
    const state = (id: SourceId, r: PromiseSettledResult<unknown>): SourceState => (r.status === "fulfilled" ? { ok: true } : { ok: false, reason: `${SOURCE_NAMES[id]} ${failureOf(r.reason)}` });
    const sources: Record<SourceId, SourceState> = { egrul: state("egrul", e), fedresurs: state("fedresurs", f), bo: state("bo", b) };
    if (Object.values(sources).every((s) => !s.ok)) throw new CounterpartyError("Реестры сейчас не отвечают. Повторите позже или проверьте вручную по ссылкам ниже.", 502);

    const boResult = b.status === "fulfilled" ? b.value : { org: null, statements: [] };
    const report = buildReport(
      { inn, egrul: e.status === "fulfilled" ? e.value : null, fedresurs: f.status === "fulfilled" ? f.value : null, bo: boResult.org, statements: boResult.statements, sources },
      new Date(now()),
    );
    // Неполный ответ (какой-то реестр молчал) в память не кладём: следующая проверка спросит заново.
    if (Object.values(sources).every((s) => s.ok)) cache.set(inn, { at: now(), report });
    return { ...report, cached: false };
  };
}
