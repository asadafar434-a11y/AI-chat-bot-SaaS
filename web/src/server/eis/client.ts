/**
 * EIS Collector v1 — HTTP/SOAP клиент СОИ.
 *
 * Требования: timeout, retry с exponential backoff, обработка HTTP 429
 * (с учётом Retry-After) и временных 5xx, санитизация ошибок от секретов.
 * Fetch-функция инжектится (тесты подставляют mock, production — global fetch).
 */

import type { EisConfig } from "./config.ts";
import { EisError, isRetryableStatus, redactSecrets } from "./errors.ts";

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface SoapCallOptions {
  /** SOAPAction / имя метода для логов (без секретов). */
  action: string;
}

export interface DownloadResult {
  bytes: Uint8Array;
  contentType?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number.parseInt(value.trim(), 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/** Exponential backoff: base * 2^attempt + детерминированный джиттер (без Math.random для стабильности тестов — см. ниже). */
export function backoffDelayMs(baseMs: number, attempt: number): number {
  // Небольшой джиттер от номера попытки, чтобы параллельные воркеры не синхронизировались.
  return baseMs * 2 ** attempt + attempt * 137;
}

export class EisHttpClient {
  private readonly config: EisConfig;
  private readonly fetchFn: FetchFn;

  constructor(config: EisConfig, fetchFn?: FetchFn) {
    this.config = config;
    this.fetchFn = fetchFn ?? ((url, init) => fetch(url, init));
  }

  /** Чистка текста от секретов с учётом конкретного authToken конфигурации. */
  private clean(text: string): string {
    return redactSecrets(text, [this.config.authToken]);
  }

  /** Заголовки авторизации СОИ. UNCONFIRMED: схема individualPerson_token — из стороннего разбора, сверить с официальной инструкцией. */
  authHeaders(): Record<string, string> {
    return { individualPerson_token: this.config.authToken };
  }

  /**
   * Выполняет f с повторами при временных ошибках.
   * Бросает последний EisError, если попытки исчерпаны.
   */
  async withRetry<T>(action: string, fn: (attempt: number) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        lastError = err;
        const retryable = err instanceof EisError ? err.retryable : true;
        if (!retryable || attempt >= this.config.maxRetries) throw err;
        const retryAfter = err instanceof EisError ? err.retryAfterMs : undefined;
        const delay = retryAfter ?? backoffDelayMs(this.config.requestDelayMs, attempt);
        await sleep(delay);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new EisError("NETWORK_ERROR", `SOAP ${action}: исчерпаны повторы`);
  }

  private async doFetch(url: string, init: RequestInit, action: string): Promise<Response> {
    const controller = new AbortController();
    // AbortSignal лишь просит fetch прерваться; зависший транспорт может его
    // игнорировать — поэтому timeout реализован через Promise.race, а не только abort.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new EisError("TIMEOUT", `SOAP ${action}: превышен timeout ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);
    });
    try {
      return await Promise.race([this.fetchFn(url, { ...init, signal: controller.signal }), timeout]);
    } catch (err) {
      if (err instanceof EisError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(msg)) {
        throw new EisError("TIMEOUT", `SOAP ${action}: превышен timeout ${this.config.timeoutMs}ms`);
      }
      throw new EisError("NETWORK_ERROR", `SOAP ${action}: сетевая ошибка: ${this.clean(msg)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async throwForStatus(res: Response, action: string): Promise<void> {
    if (res.ok) return;
    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    const status = res.status;
    if (status === 401 || status === 403) {
      throw new EisError("AUTH_ERROR", `SOAP ${action}: авторизация отклонена (HTTP ${status}). Проверьте EIS_AUTH_TOKEN.`, {
        status,
      });
    }
    if (status === 429) {
      throw new EisError("RATE_LIMITED", `SOAP ${action}: превышен rate limit (HTTP 429).`, { status, retryAfterMs });
    }
    if (isRetryableStatus(status)) {
      throw new EisError("SERVER_ERROR", `SOAP ${action}: временная ошибка сервера (HTTP ${status}).`, {
        status,
        retryAfterMs,
      });
    }
    throw new EisError("VALIDATION_ERROR", `SOAP ${action}: неуспешный статус (HTTP ${status}).`, { status });
  }

  /** Отправляет SOAP-конверт, возвращает текст ответа. SOAP Fault -> EisError(SOAP_FAULT). */
  async soapRequest(envelope: string, opts: SoapCallOptions): Promise<string> {
    return this.withRetry(opts.action, async () => {
      const res = await this.doFetch(this.config.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", ...this.authHeaders() },
        body: envelope,
      }, opts.action);
      await this.throwForStatus(res, opts.action);
      const text = await res.text();
      const fault = extractSoapFault(text);
      if (fault) {
        // Fault при валидации запроса (неверный порядок тегов и т.п.) — не повторяем.
        // Текст fault может содержать токен — чистим с учётом authToken конфигурации.
        throw new EisError("SOAP_FAULT", `SOAP ${opts.action}: fault: ${this.clean(fault)}`);
      }
      return text;
    });
  }

  /** Скачивает бинарный архив/документ по URL из dataInfo.archiveUrl. Токен — в заголовке (UNCONFIRMED, см. authHeaders). */
  async downloadBinary(url: string, action: string): Promise<DownloadResult> {
    return this.withRetry(action, async () => {
      const res = await this.doFetch(url, { method: "GET", headers: { ...this.authHeaders() } }, action);
      await this.throwForStatus(res, action);
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength === 0) {
        throw new EisError("DOCUMENT_ERROR", `SOAP ${action}: пустой ответ при скачивании ${this.clean(url)}`);
      }
      return {
        bytes: new Uint8Array(buffer),
        contentType: res.headers.get("content-type") ?? undefined,
      };
    });
  }
}

/** Извлекает текст SOAP Fault из ответа (поддерживает префиксы soap:/soapenv:/S:). */
export function extractSoapFault(xml: string): string | undefined {
  const faultMatch = xml.match(/<[^>]*:?Fault[^>]*>([\s\S]*?)<\/[^>]*:?Fault>/i);
  if (!faultMatch) return undefined;
  const inner = faultMatch[1] ?? "";
  const code = inner.match(/<[^>]*:?faultcode[^>]*>([^<]*)<\//i)?.[1]?.trim() ?? "";
  const text = inner.match(/<[^>]*:?faultstring[^>]*>([^<]*)<\//i)?.[1]?.trim() ?? inner.slice(0, 500).trim();
  return [code, text].filter(Boolean).join(": ").slice(0, 1000);
}
