import { drugQueryOf, GRLS_URL, observationsFromLimits, parseLimitRows, rowMatches, type LimitRow } from "../../lib/drug-limits.ts";
import type { Observation } from "../../lib/market-observations.ts";

// Запрос к официальному реестру предельных цен (ГРЛС, ASP.NET-форма): открыть страницу → отправить поиск по МНН → листать страницы по десять записей (запрос «PagerButton»).
// Бесплатно, без ключа и без модели; реестр общедоступный, запросов мало (один МНН — до восьми страниц), между ними пауза. Сеть подставляется: так разбор проверяется тестами без интернета.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_PAGES = 6;
// Реестр отвечает медленно (по 10–20 секунд на запрос), поэтому ждём подольше.
const TIMEOUT_MS = 60_000;

export type GrlsDeps = {
  fetch?: typeof fetch;
  pause?: () => Promise<void>;
};

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1];
const unescapeHtml = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Адрес, на который страница отправляет форму (action), полный; нет — базовый. */
const formAction = (html: string): string => {
  const raw = /<form\b[^>]*\saction="([^"]*)"/i.exec(html)?.[1];
  if (!raw) return GRLS_URL;
  try {
    const url = new URL(unescapeHtml(raw), GRLS_URL);
    return url.hostname === new URL(GRLS_URL).hostname ? url.toString() : GRLS_URL;
  } catch {
    return GRLS_URL;
  }
};

/** Все поля формы так, как их отправил бы браузер: скрытые, текстовые, отмеченные флажки, выбранные пункты списков (отключённые и кнопки не идут). */
const formFields = (html: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = attr(tag, "name");
    const type = (attr(tag, "type") ?? "text").toLowerCase();
    if (!name || /\sdisabled\b/i.test(tag) || ["submit", "button", "image", "reset", "file"].includes(type)) continue;
    if ((type === "checkbox" || type === "radio") && !/\schecked\b/i.test(tag)) continue;
    out[name] = unescapeHtml(attr(tag, "value") ?? (type === "checkbox" ? "on" : ""));
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = attr(m[1], "name");
    if (!name || /\sdisabled\b/i.test(m[1])) continue;
    const chosen = /<option\b[^>]*\sselected\b[^>]*>/i.exec(m[2])?.[0] ?? /<option\b[^>]*>/i.exec(m[2])?.[0];
    if (chosen) out[name] = unescapeHtml(attr(chosen, "value") ?? "");
  }
  return out;
};

/** Все записи реестра по МНН (до восьми страниц). */
export async function fetchLimitRows(inn: string, deps: GrlsDeps = {}): Promise<LimitRow[]> {
  const doFetch = deps.fetch ?? fetch;
  const cookies = new Map<string, string>();
  const keep = (res: Response) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const cookie = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const send = async (init: RequestInit, url = GRLS_URL): Promise<string> => {
    const res = await doFetch(url, { ...init, headers: { "User-Agent": UA, Referer: GRLS_URL, ...(cookies.size > 0 && { Cookie: cookie() }), ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    keep(res);
    if (!res.ok) throw new Error(`реестр ответил ${res.status}`);
    return res.text();
  };
  const search = (fields: Record<string, string>, target: string, argument: string, url = GRLS_URL) => {
    const form = new URLSearchParams({ ...fields, __EVENTTARGET: target, __EVENTARGUMENT: argument });
    form.set("ctl00$plate$txtINN", inn);
    form.set("ctl00$plate$txtTradeName", "");
    form.set("ctl00$plate$txtOrgName", "");
    form.set("ctl00$plate$txtRegNumber", "");
    form.set("ctl00$plate$txtBarcode", "");
    form.set("ctl00$plate$chbxisActual", "on");
    if (!target) form.set("ctl00$plate$bSeek", "Найти");
    return send({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form }, url);
  };

  const first = await send({});
  let html = await search(formFields(first), "", "");
  let { rows, total } = parseLimitRows(html);
  // Остальные страницы просим одновременно, от состояния первой страницы: так вдвое быстрее, а реестру это не нагрузка (две-пять страниц).
  const pages = Math.min(MAX_PAGES, Math.ceil((total ?? rows.length) / 10));
  if (pages >= 2) {
    await deps.pause?.();
    const fields = formFields(html);
    // Страницу результатов реестр листает на адрес из формы: в нём одноразовый token поиска (на базовый адрес он отдаёт главную страницу).
    const action = formAction(html);
    const more = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => search(fields, "PagerButton", String(i + 2), action).then((h) => parseLimitRows(h).rows)));
    for (const list of more) rows = rows.concat(list);
  }
  return rows;
}

// Один МНН просят несколько позиций и несколько закупок подряд: ответ помнится шесть часов.
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; rows: LimitRow[] }>();

/** Позиция закупки — лекарство? Тогда цены из реестра предельных цен (подходящие по МНН, дозировке, упаковке и форме). null — не лекарство или реестр не ответил: дальше обычный поиск. */
export async function lookupDrugLimits(name: string, day: string, deps: GrlsDeps & { now?: () => number } = {}): Promise<Observation[] | null> {
  const q = drugQueryOf(name);
  if (!q) return null;
  const key = q.inn.toLowerCase().split(" ")[0];
  const now = deps.now?.() ?? Date.now();
  try {
    let hit = cache.get(key);
    if (!hit || now - hit.at > CACHE_MS) {
      hit = { at: now, rows: await fetchLimitRows(q.inn.split(" ")[0], deps) };
      cache.set(key, hit);
    }
    return observationsFromLimits(q, name, hit.rows.filter((r) => rowMatches(q, r)), day);
  } catch {
    return null;
  }
}
