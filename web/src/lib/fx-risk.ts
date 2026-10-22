// Риск курса валюты по фактам: официальные курсы Банка России за год и самый большой рост курса за срок, который бывал за этот год. Из этого и суммы в валюте, которую вы закупаете, получается
// «курс может добавить до … ₽». Числа — из курсов ЦБ (cbr.ru, общедоступны), а не из допущений: «рост 10 %» не выдумывается. Прошлое не обещает будущего — сумма помечена «Оценка».
// Модуль без браузера и сервера; курсы получает сервер (server/cbr), здесь — разбор и арифметика.

export type FxCode = "USD" | "EUR" | "CNY";

/** Идентификаторы валют в справочнике ЦБ (R01235 — доллар США и т. д.). Номер в запрос к ЦБ идёт только из этого списка. */
export const FX_CURRENCIES: Record<FxCode, { id: string; name: string; sign: string }> = {
  USD: { id: "R01235", name: "Доллар США", sign: "$" },
  EUR: { id: "R01239", name: "Евро", sign: "€" },
  CNY: { id: "R01375", name: "Юань", sign: "¥" },
};

export const isFxCode = (x: unknown): x is FxCode => typeof x === "string" && Object.prototype.hasOwnProperty.call(FX_CURRENCIES, x);

/** Курс на дату: дата ГГГГ-ММ-ДД, рублей за одну единицу валюты. */
export type FxPoint = { date: string; rate: number };

const isoOfRu = (ddmmyyyy: string): string | null => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(ddmmyyyy);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const numRu = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

/** Ответ ЦБ «динамика курса» (XML_dynamic.asp): записи с датой, номиналом и значением. Курс — за одну единицу (значение ÷ номинал). Мусор пропускается. */
export function parseCbrDynamic(xml: string): FxPoint[] {
  const points: FxPoint[] = [];
  for (const m of xml.matchAll(/<Record\s+Date="([^"]+)"[^>]*>\s*<Nominal>([^<]+)<\/Nominal>\s*<Value>([^<]+)<\/Value>/g)) {
    const date = isoOfRu(m[1]);
    const nominal = numRu(m[2]);
    const value = numRu(m[3]);
    if (date && Number.isFinite(nominal) && nominal > 0 && Number.isFinite(value) && value > 0) points.push({ date, rate: value / nominal });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export type Rise = { pct: number; from: FxPoint; to: FxPoint };

/** Самый большой рост курса за любые windowDays дней подряд в ряду (в процентах). Курс не вырос ни разу — 0 %. Ряд пуст — null. */
export function worstRise(points: FxPoint[], windowDays: number): Rise | null {
  if (points.length < 2 || !Number.isFinite(windowDays) || windowDays < 1) return null;
  let best: Rise | null = null;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (daysBetween(points[i].date, points[j].date) > windowDays) break;
      const pct = (points[j].rate / points[i].rate - 1) * 100;
      if (!best || pct > best.pct) best = { pct, from: points[i], to: points[j] };
    }
  }
  if (!best) return null;
  return best.pct > 0 ? best : { pct: 0, from: best.from, to: best.to };
}

/** Что участник вводит и что сохраняется у закупки: валюта, сколько её закупается, на какой срок смотреть рост и сам ряд курсов (чтобы не запрашивать снова). */
export type FxInputs = { code: FxCode; amount: string; windowDays: string; series: [string, number][]; fetchedAt: string };
export const EMPTY_FX: FxInputs = { code: "USD", amount: "", windowDays: "90", series: [], fetchedAt: "" };

const MAX_POINTS = 800;

export function normalizeFx(raw: unknown): FxInputs {
  const x = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const series = (Array.isArray(x.series) ? x.series : []).flatMap((p): [string, number][] =>
    Array.isArray(p) && typeof p[0] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p[0]) && typeof p[1] === "number" && Number.isFinite(p[1]) && p[1] > 0 ? [[p[0], p[1]]] : [],
  );
  return {
    code: isFxCode(x.code) ? x.code : "USD",
    amount: typeof x.amount === "string" ? x.amount.slice(0, 24) : "",
    windowDays: typeof x.windowDays === "string" ? x.windowDays.slice(0, 6) : "90",
    series: series.slice(-MAX_POINTS),
    fetchedAt: typeof x.fetchedAt === "string" ? x.fetchedAt.slice(0, 40) : "",
  };
}

const positive = (s: string) => {
  const n = numRu(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export type FxResult = {
  code: FxCode;
  /** Последний курс в ряду. */
  last: FxPoint | null;
  windowDays: number | null;
  rise: Rise | null;
  /** Сколько валюты закупается. */
  amount: number | null;
  /** Закупка в рублях по последнему курсу. */
  exposure: number | null;
  /** До скольки рублей может прибавить рост курса, который бывал за этот год. */
  extra: number | null;
  /** Чего не хватает для суммы. */
  missing: string[];
};

export function fxRisk(input: FxInputs): FxResult {
  const points: FxPoint[] = input.series.map(([date, rate]) => ({ date, rate }));
  const last = points.length > 0 ? points[points.length - 1] : null;
  const windowDays = positive(input.windowDays);
  const rise = windowDays ? worstRise(points, windowDays) : null;
  const amount = positive(input.amount);
  const missing: string[] = [];
  if (!last) missing.push("загрузите курс ЦБ");
  if (!amount) missing.push("сумму в валюте");
  if (!windowDays) missing.push("срок, дней");
  const exposure = last && amount ? Math.round(amount * last.rate * 100) / 100 : null;
  const extra = exposure !== null && rise ? Math.round(exposure * (rise.pct / 100) * 100) / 100 : null;
  return { code: input.code, last, windowDays, rise, amount, exposure, extra, missing };
}
