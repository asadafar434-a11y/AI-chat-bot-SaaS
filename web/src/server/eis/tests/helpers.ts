/**
 * EIS Collector v1 — общие тестовые помощники (не *.test.ts, в прогон не входят сами).
 */
import { deflateRawSync } from "node:zlib";
import type { EisOcrInput, EisOcrResult, OcrProvider } from "../extract/ocr.ts";

/** Mock OCR-провайдер для тестов: детерминированный текст + confidence. */
export class MockOcrProvider implements OcrProvider {
  readonly name = "mock";
  readonly configured = true;
  async extractOcr(input: EisOcrInput): Promise<EisOcrResult> {
    return {
      provider: this.name,
      pages: input.pages.map((pageNumber) => ({ pageNumber, text: `Распознанный текст страницы ${pageNumber}`, confidence: 0.9 })),
    };
  }
}

export interface ZipEntrySpec {
  name: string;
  data: Uint8Array;
  /** 0 = stored, 8 = deflate. */
  method?: 0 | 8;
}

/** Строит валидный ZIP (local headers + central directory + EOCD) без внешних зависимостей. */
export function makeZip(entries: ZipEntrySpec[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (arr: Uint8Array[]): void => {
    for (const c of arr) chunks.push(c);
  };
  const u16 = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v: number): Uint8Array =>
    new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
  const concat = (...parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  for (const e of entries) {
    const method = e.method ?? 0;
    const name = enc.encode(e.name);
    const raw = e.data;
    const stored = method === 8 ? deflateRawSync(raw) : raw;
    const local = concat(
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(0), // crc — парсер v1 не проверяет
      u32(stored.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      name,
      stored,
    );
    push([local]);
    const cd = concat(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(stored.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    );
    central.push(cd);
    offset += local.length;
  }
  const cdStart = offset;
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  push(central);
  offset += cdSize;
  void offset;
  const eocd = concat(u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cdSize), u32(cdStart), u16(0));
  push([eocd]);
  return concat(...chunks);
}

/** SOAP-ответ discovery в синхронном режиме (номера прямо в ответе). */
export function soapDiscoveryResponse(registryNumbers: string[]): string {
  const items = registryNumbers.map((n) => `<reestrNumber>${n}</reestrNumber>`).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><ns2:getDocsByOrgRegionResponse xmlns:ns2="http://zakupki.gov.ru/fz44/get-docs-ip/ws">` +
    `<dataInfo>${items}</dataInfo></ns2:getDocsByOrgRegionResponse></soap:Body></soap:Envelope>`
  );
}

/** SOAP-ответ со ссылкой на архив ХД (асинхронный режим СОИ). */
export function soapArchiveResponse(archiveUrl: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><ns2:getDocsByOrgRegionResponse xmlns:ns2="http://zakupki.gov.ru/fz44/get-docs-ip/ws">` +
    `<dataInfo><archiveUrl>${archiveUrl}</archiveUrl></dataInfo></ns2:getDocsByOrgRegionResponse></soap:Body></soap:Envelope>`
  );
}

/** Минимальный mock fetch: очередь ответов/ошибок по вызову. */
export function mockFetchSequence(
  steps: Array<{ status?: number; body?: string | Uint8Array; headers?: Record<string, string> } | Error>,
): { fetchFn: (url: string, init: RequestInit) => Promise<Response>; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fetchFn = async (url: string): Promise<Response> => {
    calls.push(url);
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step instanceof Error) throw step;
    const body = step.body ?? "";
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    const headers = new Headers({ "content-type": "text/xml; charset=utf-8", ...(step.headers ?? {}) });
    return new Response(bytes as BodyInit, { status: step.status ?? 200, headers });
  };
  return { fetchFn, calls };
}

/** Сохраняет/восстанавливает process.env вокруг теста. */
export function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    const v = vars[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}
