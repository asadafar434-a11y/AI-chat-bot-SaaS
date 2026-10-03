/**
 * EIS Collector v1 — ошибки.
 *
 * Все сообщения об ошибках санитизируются от секретов до того, как попадут
 * в логи, manifests или результаты (см. redactSecrets).
 */

export type EisErrorCode =
  | "CONFIG_ERROR"
  | "AUTH_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "SOAP_FAULT"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "NOT_IMPLEMENTED"
  | "STORAGE_ERROR"
  | "DOCUMENT_ERROR";

/** Коды, при которых client.ts повторяет запрос с exponential backoff. */
const RETRYABLE_CODES: ReadonlySet<EisErrorCode> = new Set([
  "NETWORK_ERROR",
  "TIMEOUT",
  "RATE_LIMITED",
  "SERVER_ERROR",
]);

/** HTTP-статусы, считающиеся временными (повторяемыми). */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

export class EisError extends Error {
  readonly code: EisErrorCode;
  /** HTTP-статус, если ошибка пришла из HTTP-слоя. */
  readonly status?: number;
  /** Значение заголовка Retry-After (секунды), если сервер его прислал. */
  readonly retryAfterMs?: number;

  constructor(code: EisErrorCode, message: string, opts?: { status?: number; retryAfterMs?: number; cause?: unknown }) {
    super(redactSecrets(message));
    this.name = "EisError";
    this.code = code;
    this.status = opts?.status;
    this.retryAfterMs = opts?.retryAfterMs;
    if (opts?.cause !== undefined) {
      // cause может содержать секреты (URL с токеном) — не сохраняем как есть.
      this.cause = redactSecrets(String(opts.cause));
    }
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }
}

/**
 * Вырезает возможные секреты из текста ошибок/логов.
 * Покрывает: токены в заголовках/URL, EIS_* secrets, query-параметры token/key.
 * Эвристика намеренно широкая: лучше замаскировать лишнее, чем уронить секрет в лог.
 * extraSecrets — точные значения секретов (например, EIS_AUTH_TOKEN): вычищаются
 * дословно, т.к. их формат заранее неизвестен и эвристики может не хватить.
 */
export function redactSecrets(text: string, extraSecrets?: string[]): string {
  let out = text;
  // individualPerson_token / auth_token в XML и заголовках: <tag>value</tag> или "tag": "value" или tag=value.
  out = out.replace(
    /((?:individualPerson_token|auth_token|access_token|api[_-]?key|client[_-]?secret|password|passwd|pwd)\s*[:=>]\s*["']?)([^"'<>\s&;]+)/gi,
    "$1***",
  );
  out = out.replace(
    /(<(?:individualPerson_token|auth_token|access_token)>)([^<]+)(<\/(?:individualPerson_token|auth_token|access_token)>)/gi,
    "$1***$3",
  );
  // Токен в query string (?token=... / &token=...).
  out = out.replace(/([?&](?:token|auth_token|api_key|key)=)([^&\s"']+)/gi, "$1***");
  // Bearer-схемы.
  out = out.replace(/(Bearer\s+)([A-Za-z0-9._~+/-]+)/g, "$1***");
  // Значения EIS_*SECRET/PASSWORD/TOKEN* в дампах вида EIS_PASSWORD=xxx / EIS_SECRET_KEY=yyy.
  out = out.replace(/\b(EIS_[A-Z_]*(?:SECRET|PASSWORD|TOKEN)[A-Z_]*)\s*=\s*("[^"]*"|'[^']*'|\S+)/g, "$1=***");
  for (const secret of extraSecrets ?? []) {
    if (secret && secret.length >= 4 && out.includes(secret)) {
      out = out.split(secret).join("***");
    }
  }
  return out;
}

/** Безопасный текст ошибки для логов/результатов: код + санитизированное сообщение. */
export function errorText(err: unknown): string {
  if (err instanceof EisError) return `[${err.code}] ${err.message}`;
  if (err instanceof Error) return redactSecrets(err.message);
  return redactSecrets(String(err));
}
