import "server-only";
import {
  parseCheckoCompany,
  parseCheckoEnforcements,
  parseCheckoFinances,
  parseCheckoLegalCases,
  parseCheckoReliability,
  type Parts,
  type SourceState,
} from "@/lib/counterparty";

// Checko API как один источник вместо трёх реестров: /company (ЕГРЮЛ, РНП, налоги, МСП, численность, ЕФРСБ, санкции, контакты),
// /finances (ГИР БО), /legal-cases (КАД), /enforcements (ФССП) и /reliability (оценка сервиса Checko). Ключ живёт только на сервере;
// в ответ участнику и в кэш он не попадает. Пять запросов на одну проверку. Если Checko ответил «не найдено» — это не сбой,
// отчёт пустой и честный; если ошибка — загрузчик (counterparty.ts) откатывается на открытые реестры.

const USER_AGENT = "Mozilla/5.0 (compatible; TenderLawyer/1.0; counterparty-check)";

export class CheckoError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

class SourceError extends Error {}
class NotFound extends Error {}

export type CheckoOptions = { apiKey: string; fetcher?: typeof fetch; timeoutMs?: number; baseUrl?: string };

const failureOf = (error: unknown): string =>
  error instanceof SourceError ? error.message : error instanceof Error && error.name === "TimeoutError" ? "не ответил вовремя" : "не ответил";

export function createCheckoLoader(options: CheckoOptions) {
  const fetcher = options.fetcher ?? fetch;
  const timeout = options.timeoutMs ?? 12_000;
  const baseUrl = (options.baseUrl ?? "https://api.checko.ru/v2").replace(/\/+$/, "");
  const apiKey = options.apiKey.trim();

  async function get(method: string, inn: string, extra: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${baseUrl}/${method}`);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("inn", inn);
    for (const [name, value] of Object.entries(extra)) url.searchParams.set(name, value);

    const response = await fetcher(url.toString(), {
      signal: AbortSignal.timeout(timeout),
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (response.status === 401 || response.status === 403 || response.status === 429) throw new SourceError(`отказал в доступе (${response.status})`);
    if (!response.ok) throw new SourceError(`ответил ошибкой ${response.status}`);

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new SourceError("вернул непонятный ответ");
    }

    const meta = (json as { meta?: { status?: unknown; message?: unknown } })?.meta;
    if (meta?.status === "error") {
      const raw = typeof meta.message === "string" ? meta.message.replace(/\s+/g, " ").trim() : "";
      const message = (raw.split(apiKey).join("***") || "без пояснения").slice(0, 160);
      if (/не\s+найд|не\s+существу/i.test(message)) throw new NotFound();
      throw new SourceError(`ответил ошибкой: ${message}`);
    }
    return json;
  }

  return async function load(inn: string): Promise<Parts> {
    const method = inn.length === 12 ? "entrepreneur" : "company";
    const [company, finances, courts, enforcements, reliability] = await Promise.allSettled([
      get(method, inn),
      get("finances", inn),
      get("legal-cases", inn, { sort: "-date", limit: "100" }),
      get("enforcements", inn, { sort: "-date", limit: "100" }),
      get("reliability", inn),
    ]);

    if (company.status === "rejected") {
      if (company.reason instanceof NotFound) {
        return { inn, egrul: null, fedresurs: null, bo: null, statements: [], provider: "checko", sources: { checko: { ok: true } } };
      }
      throw new CheckoError(`Checko ${failureOf(company.reason)}`, company.reason instanceof SourceError ? 502 : 504);
    }

    const parsed = parseCheckoCompany(company.value, inn);
    if (!parsed) {
      // Ответ без данных и без ошибки: считаем, что организации нет, — как это делает ЕГРЮЛ.
      return { inn, egrul: null, fedresurs: null, bo: null, statements: [], provider: "checko", sources: { checko: { ok: true } } };
    }

    const failed: string[] = [];
    if (finances.status === "rejected") failed.push("отчётность");
    if (courts.status === "rejected") failed.push("суды");
    if (enforcements.status === "rejected") failed.push("приставы");
    if (reliability.status === "rejected") failed.push("оценка надёжности");
    const state: SourceState = failed.length === 0 ? { ok: true } : { ok: false, reason: `Checko: не ответил по части «${failed.join(", ")}»` };

    return {
      inn,
      egrul: parsed.identity,
      fedresurs: null,
      bo: null,
      address: parsed.address,
      statusText: parsed.statusText,
      statements: finances.status === "fulfilled" ? parseCheckoFinances(finances.value) : [],
      rnp: parsed.rnp,
      taxes: parsed.taxes,
      msp: parsed.msp,
      staff: parsed.staff,
      courts: courts.status === "fulfilled" ? parseCheckoLegalCases(courts.value, inn) : null,
      enforcements: enforcements.status === "fulfilled" ? parseCheckoEnforcements(enforcements.value) : null,
      efrsb: parsed.efrsb,
      sanctions: parsed.sanctions,
      contacts: parsed.contacts,
      reliability: reliability.status === "fulfilled" ? parseCheckoReliability(reliability.value) : null,
      provider: "checko",
      sources: { checko: state },
    };
  };
}
