import "server-only";
import { sameSubject, type RateObservation } from "@/lib/rate-extract";
import { trudvsemRegionCode } from "@/lib/region-codes";

// Зарплаты по настоящим вакансиям региона из открытых данных «Работа в России» (opendata.trudvsem.ru, Роструд): бесплатно, без ИИ, без капчи и без блокировок, данные свежие.
// Это главный источник зарплат: поиск по сайтам вакансий (дорогой, с отказами 429 и случайными цифрами) остаётся запасным. По вакансиям берётся середина вилки «от … до …»
// (где названа только нижняя граница — она; «до» без «от» не берётся), итог — медиана; вакансий должно быть не меньше трёх, иначе источнику не верим.

export const MIN_VACANCIES = 3;
const MAX_VACANCIES = 100;

type Vacancy = { "job-name"?: unknown; salary_min?: unknown; salary_max?: unknown; currency?: unknown; "creation-date"?: unknown; date_modify?: unknown };

const asNumber = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** Слова поиска по вакансиям: полное название должности; если по нему мало — последнее слово («штабелера» вместо «Водитель штабелера»). */
export function vacancySearchTexts(role: string): string[] {
  const clean = role.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const last = clean.split(" ").filter((w) => w.length >= 5).pop();
  return [...new Set([clean, ...(last && last !== clean ? [last] : [])])];
}

/** Оценка зарплаты в регионе по открытым вакансиям; нет региона в нашем списке, мало подходящих вакансий или источник не ответил — null (тогда идёт запасной поиск). */
export async function officialSalary(item: { subject: string; region: string | null }, day: string, fetcher: typeof fetch = fetch, timeoutMs = 20_000): Promise<RateObservation | null> {
  const code = trudvsemRegionCode(item.region);
  if (!code) return null;
  for (const text of vacancySearchTexts(item.subject)) {
    const url = `https://opendata.trudvsem.ru/api/v1/vacancies/region/${code}?text=${encodeURIComponent(text)}&limit=${MAX_VACANCIES}`;
    let list: Vacancy[];
    try {
      const res = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; TenderLawyer/1.0; open-data)" } });
      if (!res.ok) continue;
      const json = (await res.json()) as { results?: { vacancies?: { vacancy?: Vacancy }[] } };
      list = (json.results?.vacancies ?? []).flatMap((v) => (v.vacancy ? [v.vacancy] : []));
    } catch {
      continue;
    }
    const values: number[] = [];
    for (const v of list) {
      if (!sameSubject(item.subject, String(v["job-name"] ?? ""))) continue;
      if (typeof v.currency === "string" && !/руб/i.test(v.currency)) continue;
      const min = asNumber(v.salary_min);
      const max = asNumber(v.salary_max);
      const value = min !== null && max !== null ? (min + max) / 2 : min;
      if (value !== null && value >= 20_000 && value <= 1_500_000) values.push(value);
    }
    if (values.length < MIN_VACANCIES) continue;
    const sorted = [...values].sort((a, b) => a - b);
    return {
      kind: "salary",
      subject: item.subject,
      monthly: Math.round(median(values)),
      min: Math.round(quantile(sorted, 0.25)),
      max: Math.round(quantile(sorted, 0.75)),
      region: item.region,
      regionMatch: "same",
      host: "opendata.trudvsem.ru",
      url,
      date: day,
      quote: `«Работа в России» (Роструд), открытые данные: вакансий «${text}» в регионе — ${values.length}; зарплата по середине вилки «от … до …»: медиана ${Math.round(median(values)).toLocaleString("ru-RU")} ₽, средние 50 % вакансий — от ${Math.round(quantile(sorted, 0.25)).toLocaleString("ru-RU")} до ${Math.round(quantile(sorted, 0.75)).toLocaleString("ru-RU")} ₽`,
      notes: [`по ${values.length} вакансиям региона на ${day.split("-").reverse().join(".")}: объявленная зарплата, не фактическая`, "налоги в вакансиях не названы — принято как до вычета налогов"],
    };
  }
  return null;
}
