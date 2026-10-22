import { lookup } from "node:dns/promises";
import { checkUrl, isPrivateIp } from "./net-guard.ts";

// Скачивание одной страницы поставщика для чтения моделью. По одной странице, последовательно, без обхода сайта; перед каждым обращением (и перед каждым переходом) адрес проверяется: имя сайта должно
// указывать только на публичные адреса. Размер ответа и время ограничены. Только текстовые страницы (HTML и обычный текст).

export type PageFetch = { ok: true; html: string; finalUrl: string } | { ok: false; error: string };

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
// Только латиница: в заголовке запроса русские буквы не допускаются.
const USER_AGENT = "Mozilla/5.0 (compatible; TenderLawyerPriceReader/1.0; reads one page to find a price)";

async function publicHost(hostname: string): Promise<string | null> {
  try {
    const found = await lookup(hostname, { all: true });
    if (found.length === 0) return "имя сайта не найдено";
    if (found.some((a) => isPrivateIp(a.address))) return "имя сайта указывает на закрытый адрес";
    return null;
  } catch {
    return "имя сайта не найдено";
  }
}

async function readLimited(res: Response): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const type = res.headers.get("content-type") ?? "";
  const charset = /charset=([\w-]+)/i.exec(type)?.[1]?.toLowerCase() ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString("latin1"))?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(/1251|cp1251/.test(charset) ? "windows-1251" : charset).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

export async function fetchHtml(startUrl: string, fetcher: typeof fetch = fetch): Promise<PageFetch> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = checkUrl(current);
    if (!checked.ok) return { ok: false, error: checked.reason };
    const blocked = await publicHost(checked.url.hostname);
    if (blocked) return { ok: false, error: blocked };
    let res: Response;
    try {
      res = await fetcher(checked.url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain;q=0.9", "Accept-Language": "ru-RU,ru;q=0.9" } });
    } catch {
      return { ok: false, error: "страница не открылась" };
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return { ok: false, error: "переход без адреса" };
      current = new URL(next, checked.url).toString();
      continue;
    }
    if (!res.ok) return { ok: false, error: `ответ ${res.status}` };
    const type = res.headers.get("content-type") ?? "";
    if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) return { ok: false, error: "не текстовая страница" };
    const html = await readLimited(res);
    return html ? { ok: true, html, finalUrl: current } : { ok: false, error: "пустая страница" };
  }
  return { ok: false, error: "слишком много переходов" };
}
