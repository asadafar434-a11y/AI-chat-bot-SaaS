/**
 * Подпись AWS Signature Version 4 для S3 без SDK (только `node:crypto`).
 *
 * Реализован ровно путь presigned-URL для GET (скачивание): других операций
 * подписи не требуют в нашем flow (PUT/DELETE идут с `Authorization`-заголовком
 * либо вообще без подписи внутри приватной сети — см. `s3.ts`). Зависимостей
 * нет, поэтому в production не тянется AWS SDK, а credentials не покидают
 * сервер: в URL уходит только подпись.
 *
 * Шаги — по спецификации SigV4: канонический запрос → строка для подписи →
 * цепочка ключей (дата/регион/сервис) → подпись → query-параметры.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** RFC 3986: `encodeURIComponent` плюс `!'()*`, которые он оставляет как есть. */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function sha256HexUtf8(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hmacSha256(key: Uint8Array | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export type AmzDates = { amzDate: string; dateStamp: string };

/** `20130524T000000Z` + `20130524` из момента времени (всегда UTC). */
export function amzDates(now: Date): AmzDates {
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const amzDate =
    `${dateStamp}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  return { amzDate, dateStamp };
}

/**
 * Разбор `YYYYMMDDTHHMMSSZ` в Date (UTC). Формат строгий: 'T' — индекс 8,
 * часы — 9..11. Невалидное — null, а не исключение.
 */
export function parseAmzDate(value: string | undefined): Date | null {
  if (!value || !/^\d{8}T\d{6}Z$/.test(value)) {
    return null;
  }
  const date = new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8)),
      Number(value.slice(9, 11)),
      Number(value.slice(11, 13)),
      Number(value.slice(13, 15)),
    ),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Цепочка ключей подписи: секрет → дата → регион → сервис → `aws4_request`. */
export function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${secret}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

export type PresignInput = {
  endpoint: string;
  bucket: string;
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresIn: number;
  now?: Date;
  pathStyle?: boolean;
  extraQuery?: Record<string, string>;
};

function splitEndpoint(endpoint: string): { protocol: string; host: string } {
  const url = new URL(endpoint);
  return { protocol: `${url.protocol}//`, host: url.host };
}

function canonicalUri(bucket: string, key: string, pathStyle: boolean): string {
  const segments = key.split("/").map((s) => encodeRfc3986(s));
  if (pathStyle) {
    return `/${encodeRfc3986(bucket)}/${segments.join("/")}`;
  }
  return `/${segments.join("/")}`;
}

/**
 * Подписанный GET-URL. Возвращает URL и момент истечения. Подпись покрывает
 * метод, путь, все query-параметры и заголовок `host`: смена хоть одного бита
 * делает подпись недействительной (проверяется тестами).
 */
export function presignGetUrl(input: PresignInput): { url: string; expiresAt: Date } {
  const now = input.now ?? new Date();
  const expiresIn = Math.max(1, Math.floor(input.expiresIn));
  const { amzDate, dateStamp } = amzDates(now);
  const service = "s3";
  const pathStyle = input.pathStyle ?? true;
  const { protocol, host } = splitEndpoint(input.endpoint);
  const uri = canonicalUri(input.bucket, input.key, pathStyle);
  const hostHeader = pathStyle ? host : `${input.bucket}.${host}`;

  const credential = `${input.accessKeyId}/${dateStamp}/${input.region}/${service}/aws4_request`;
  const params: Record<string, string> = {
    ...(input.extraQuery ?? {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(params[k])}`)
    .join("&");
  const canonicalHeaders = `host:${hostHeader.trim()}\n`;
  const canonicalRequest = ["GET", uri, canonicalQuery, canonicalHeaders, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256HexUtf8(canonicalRequest)].join("\n");
  const signature = hmacSha256(signingKey(input.secretAccessKey, dateStamp, input.region, service), stringToSign).toString("hex");

  const base = pathStyle ? `${protocol}${host}${uri}` : `${protocol}${input.bucket}.${host}${uri}`;
  return {
    url: `${base}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
  };
}

export type PresignCheck =
  | { ok: true; key: string; expiresAt: Date }
  | { ok: false; reason: "bad-signature" | "expired" | "malformed" | "not-yet-valid" };

/**
 * Проверка подписанного URL серверной стороной (для тестов stub-сервера и
 * документирования инвариантов; production S3 проверяет сам). Секрет никуда
 * не записывается.
 */
export function verifyPresignedUrl(
  url: string,
  options: {
    secretAccessKey: string;
    region: string;
    bucket?: string;
    pathStyle?: boolean;
    now?: Date;
    maxSkewSeconds?: number;
  },
): PresignCheck {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // Разбор вручную: URLSearchParams превращает "+" в пробел и ломает round-trip.
  const params = new Map<string, string>();
  for (const pair of parsed.search.slice(1).split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      continue;
    }
    try {
      params.set(decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1)));
    } catch {
      return { ok: false, reason: "malformed" };
    }
  }
  const signature = params.get("X-Amz-Signature");
  const credential = params.get("X-Amz-Credential");
  const amzDate = params.get("X-Amz-Date");
  const expires = Number(params.get("X-Amz-Expires"));
  const signedHeaders = params.get("X-Amz-SignedHeaders");
  if (!signature || !credential || !amzDate || !Number.isFinite(expires) || signedHeaders !== "host") {
    return { ok: false, reason: "malformed" };
  }
  const credentialParts = credential.split("/");
  if (credentialParts.length !== 5) {
    return { ok: false, reason: "malformed" };
  }
  const [, dateStamp, region, service] = credentialParts;
  if (region !== options.region || service !== "s3") {
    return { ok: false, reason: "malformed" };
  }
  const now = options.now ?? new Date();
  const issued = parseAmzDate(amzDate);
  if (!issued) {
    return { ok: false, reason: "malformed" };
  }
  const skew = (options.maxSkewSeconds ?? 300) * 1000;
  if (issued.getTime() > now.getTime() + skew) {
    return { ok: false, reason: "not-yet-valid" };
  }
  if (issued.getTime() + expires * 1000 <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  const query: Record<string, string> = {};
  for (const [k, v] of params) {
    if (k !== "X-Amz-Signature" && k !== "") {
      query[k] = v;
    }
  }
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k])}`)
    .join("&");
  const hostHeader = parsed.host;
  const canonicalRequest = ["GET", parsed.pathname, canonicalQuery, `host:${hostHeader}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256HexUtf8(canonicalRequest)].join("\n");
  const expected = hmacSha256(signingKey(options.secretAccessKey, dateStamp, region, service), stringToSign);
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "hex");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "bad-signature" };
  }
  const pathStyle = options.pathStyle ?? true;
  const bucket = options.bucket ?? "";
  const segments = parsed.pathname.split("/").slice(1).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  });
  if (segments.some((s) => s === null)) {
    return { ok: false, reason: "malformed" };
  }
  const names = segments as string[];
  const key = pathStyle ? names.slice(bucket ? 1 : 0).join("/") : names.join("/");
  if (pathStyle && bucket && names[0] !== bucket) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, key, expiresAt: new Date(issued.getTime() + expires * 1000) };
}

export type HeaderAuthInput = {
  method: string;
  endpoint: string;
  bucket: string;
  key: string;
  query?: Record<string, string>;
  headers: Record<string, string>;
  payloadHashHex: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  now?: Date;
  pathStyle?: boolean;
};

/**
 * Заголовок `Authorization` для серверных вызовов (PUT/DELETE/HEAD/LIST).
 * Подписываются метод, путь, query и перечисленные заголовки вместе с хешем
 * тела: сервер S3 проверяет всё это до выполнения операции.
 */
export function authorizationHeader(input: HeaderAuthInput): { authorization: string; amzDate: string } {
  const now = input.now ?? new Date();
  const { amzDate, dateStamp } = amzDates(now);
  const service = "s3";
  const pathStyle = input.pathStyle ?? true;
  const { protocol, host } = splitEndpoint(input.endpoint);
  void protocol;
  const uri = canonicalUri(input.bucket, input.key, pathStyle);
  const hostHeader = pathStyle ? host : `${input.bucket}.${host}`;
  const names = ["host", ...Object.keys(input.headers).map((h) => h.toLowerCase())].sort();
  const values: Record<string, string> = { host: hostHeader.trim() };
  for (const [k, v] of Object.entries(input.headers)) {
    values[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  }
  const canonicalHeaders = names.map((n) => `${n}:${values[n]}\n`).join("");
  const canonicalQuery = Object.keys(input.query ?? {})
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986((input.query ?? {})[k])}`)
    .join("&");
  const canonicalRequest = [input.method.toUpperCase(), uri, canonicalQuery, canonicalHeaders, names.join(";"), input.payloadHashHex].join("\n");
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256HexUtf8(canonicalRequest)].join("\n");
  const signature = hmacSha256(signingKey(input.secretAccessKey, dateStamp, input.region, service), stringToSign).toString("hex");
  const credential = `${input.accessKeyId}/${scope}`;
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${credential}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    amzDate,
  };
}

/** sha256 байтов тела в hex (для подписи PUT и сверок). */
export function sha256HexBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
