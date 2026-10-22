import "server-only";
import { FX_CURRENCIES, parseCbrDynamic, type FxCode, type FxPoint } from "@/lib/fx-risk";

// Курсы Банка России за последний год: сервер запрашивает общедоступный адрес cbr.ru, участник получает только ряд «дата — курс».
// В запрос к ЦБ уходит только номер валюты из нашего списка и две даты, ничего от участника. Ответ держится в памяти час.

export class CbrError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type CbrOutcome = { code: FxCode; name: string; points: FxPoint[]; at: string; cached: boolean };

export type CbrOptions = { fetcher?: typeof fetch; now?: () => number; ttlMs?: number; timeoutMs?: number; days?: number };

const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

export function createCbrLoader(options: CbrOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? 60 * 60 * 1000;
  const timeout = options.timeoutMs ?? 10_000;
  const days = options.days ?? 372;
  const cache = new Map<FxCode, { at: number; outcome: CbrOutcome }>();

  return async function load(code: FxCode): Promise<CbrOutcome> {
    const saved = cache.get(code);
    if (saved && now() - saved.at < ttl) return { ...saved.outcome, cached: true };
    const to = new Date(now());
    const from = new Date(now() - days * 86_400_000);
    const url = `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${ddmmyyyy(from)}&date_req2=${ddmmyyyy(to)}&VAL_NM_RQ=${FX_CURRENCIES[code].id}`;
    let response: Response;
    try {
      response = await fetcher(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: "application/xml,text/xml" } });
    } catch {
      throw new CbrError("Банк России не ответил вовремя. Повторите позже.", 504);
    }
    if (!response.ok) throw new CbrError("Банк России сейчас не отдаёт курсы. Повторите позже.", 502);
    // Ответ ЦБ — в кодировке windows-1251.
    const xml = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
    const points = parseCbrDynamic(xml);
    if (points.length < 2) throw new CbrError("Банк России вернул пустой ряд курсов. Повторите позже.", 502);
    const outcome: CbrOutcome = { code, name: FX_CURRENCIES[code].name, points, at: new Date(now()).toISOString(), cached: false };
    cache.set(code, { at: now(), outcome });
    return outcome;
  };
}
