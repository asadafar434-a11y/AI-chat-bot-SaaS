// «До какой цены снижаться»: самая низкая цена, при которой контракт не в убыток. Считает браузер, без ИИ.
// В расчёте — расходы на исполнение и на участие, налог с выручки, стоимость обеспечения исполнения
// (комиссия банка за гарантию или цена своих денег) и антидемпинговые меры.
//
// Логика — из таблицы «Расчёт рентабельности контракта» (docs/templates), сверена с 44-ФЗ в редакции от 04.08.2026:
// - обеспечение исполнения — процент от начальной цены, в закупке у малого бизнеса и СОНКО — от цены контракта
//   (ч. 6 и 6.2 ст. 96);
// - в такой закупке участник с тремя контрактами за три года без неустоек на сумму не меньше начальной цены
//   освобождается от обеспечения, в том числе от повышенного (ч. 8.1 ст. 96);
// - снижение на 25 % и больше на конкурсе или аукционе — обеспечение в полтора раза больше, но не меньше 10 %
//   от начальной цены или от цены контракта в закупке у малого бизнеса (ч. 1 ст. 37); при начальной цене
//   до 15 млн вместо этого можно подтвердить добросовестность — тогда обеспечение обычное (ч. 2 и 3 ст. 37).
// Аванс не учитывается: обеспечение и так не меньше аванса (п. 1 ч. 6 ст. 96).

export type SecurityMethod = "guarantee" | "money";

// Что вводит участник. Пустое поле — null.
export type PriceCalc = {
  nmck: number | null;
  costs: number | null;
  extra: number | null;
  taxPct: number | null;
  securityPct: number | null;
  smeOnly: boolean;
  exempt: boolean;
  method: SecurityMethod;
  // Комиссия банка за гарантию и цена своих денег — в процентах годовых, у каждого способа своя.
  guaranteeRatePct: number | null;
  moneyRatePct: number | null;
  days: number | null;
  antiDumping: boolean;
  goodFaith: boolean;
  price: number | null;
};

export const GOOD_FAITH_LIMIT = 15_000_000;

// Повышенное обеспечение по ч. 1 ст. 37, в процентах: в полтора раза больше обычного, но не меньше 10.
export const raisedPct = (securityPct: number) => Math.max(securityPct * 1.5, 10);

type Ready = {
  nmck: number;
  costs: number;
  extra: number;
  tax: number;
  share: number;
  raisedShare: number;
  fromPrice: boolean;
  // Сколько стоит рубль обеспечения за весь срок: ставка годовых × дни / 365.
  rate: number;
  antiDumping: boolean;
};

const num = (value: number | null) => (value !== null && Number.isFinite(value) && value > 0 ? value : 0);
const pct = (value: number | null) => Math.min(num(value), 100) / 100;
const kopecks = (value: number) => Math.round(value * 100);

function ready(c: PriceCalc): Ready | null {
  if (!c.nmck || !(c.nmck > 0) || !c.costs || !(c.costs > 0)) return null;
  const share = c.smeOnly && c.exempt ? 0 : pct(c.securityPct);
  return {
    nmck: c.nmck,
    costs: c.costs,
    extra: num(c.extra),
    tax: pct(c.taxPct),
    share,
    raisedShare: share > 0 ? raisedPct(share * 100) / 100 : 0,
    fromPrice: c.smeOnly,
    rate: (pct(c.method === "guarantee" ? c.guaranteeRatePct : c.moneyRatePct) * num(c.days)) / 365,
    antiDumping: c.antiDumping && share > 0 && !(c.goodFaith && c.nmck <= GOOD_FAITH_LIMIT),
  };
}

// Снижение на 25 % и больше: цена не выше трёх четвертей начальной. Сравнение в копейках, чтобы граница была точной.
const raisedAt = (r: Ready, price: number) => r.antiDumping && 4 * kopecks(price) <= 3 * kopecks(r.nmck);

export type Breakdown = {
  price: number;
  // Насколько цена ниже начальной: 0,25 — на 25 %.
  drop: number;
  costs: number;
  extra: number;
  tax: number;
  // Обеспечение исполнения в рублях и в процентах от своей базы; raised — повышенное по ст. 37.
  security: number;
  securityPct: number;
  raised: boolean;
  securityCost: number;
  profit: number;
};

function breakdownAt(r: Ready, price: number): Breakdown {
  const raised = raisedAt(r, price);
  const share = raised ? r.raisedShare : r.share;
  const security = share * (r.fromPrice ? price : r.nmck);
  const securityCost = security * r.rate;
  const tax = price * r.tax;
  return {
    price,
    drop: 1 - price / r.nmck,
    costs: r.costs,
    extra: r.extra,
    tax,
    security,
    securityPct: share * 100,
    raised,
    securityCost,
    profit: price - r.costs - r.extra - tax - securityCost,
  };
}

// Цена без прибыли и убытка при такой доле обеспечения. null — налог и обеспечение съедают всю цену.
function breakEven(r: Ready, share: number): number | null {
  if (r.fromPrice) {
    const left = 1 - r.tax - share * r.rate;
    return left > 0 ? (r.costs + r.extra) / left : null;
  }
  const left = 1 - r.tax;
  return left > 0 ? (r.costs + r.extra + share * r.nmck * r.rate) / left : null;
}

// plain — обычный расчёт; antiDumping — нижняя цена уже с повышенным обеспечением;
// threshold — при снижении на 25 % обеспечение растёт и контракт уходит в убыток, поэтому нижняя цена —
// на копейку выше трёх четвертей начальной.
export type FloorKind = "plain" | "antiDumping" | "threshold";
export type Floor =
  | { ok: true; price: number; kind: FloorKind; aboveNmck: boolean }
  | { ok: false; reason: "input" | "impossible" };

const ceilKopecks = (value: number) => Math.ceil(value * 100 - 1e-6) / 100;

export function priceFloor(c: PriceCalc): { floor: Floor; at: (price: number) => Breakdown | null } {
  const r = ready(c);
  if (!r) return { floor: { ok: false, reason: "input" }, at: () => null };
  const at = (price: number) => (price > 0 ? breakdownAt(r, price) : null);
  const done = (price: number, kind: FloorKind) => ({
    floor: { ok: true as const, price, kind, aboveNmck: price > r.nmck },
    at,
  });

  const plain = breakEven(r, r.share);
  if (plain === null) return { floor: { ok: false, reason: "impossible" }, at };
  if (!raisedAt(r, ceilKopecks(plain))) return done(ceilKopecks(plain), "plain");

  const raised = breakEven(r, r.raisedShare);
  if (raised !== null && raisedAt(r, ceilKopecks(raised))) return done(ceilKopecks(raised), "antiDumping");
  return done((Math.floor((3 * kopecks(r.nmck)) / 4) + 1) / 100, "threshold");
}

// ---------- что подставить из закупки ----------

type PurchaseLike = {
  kind: string;
  tpPrice?: number;
  requirements: Record<string, { text: string; quote: string }[]>;
};

// «Обеспечение исполнения контракта — 5% от цены контракта». Между словами и процентом не должно быть
// ни обеспечения заявки или гарантийных обязательств (у них свои проценты), ни нового предложения, ни «не требуется».
const SECURITY =
  /обеспеч\S*\s+исполнени\S*((?:(?!заявк|гарантийн|не\s+(?:требует|установлен|предусмотрен))[^%\n]){0,150}?)(\d+(?:[.,]\d+)?)\s*%([^.\n]{0,80})/i;
const NEW_SENTENCE = /\.\s+[А-ЯЁA-Z]/;
const SME_ONLY = /(только|исключительно|осуществляется у|ограничени\S* участия)[^.\n]{0,80}(малого|СМП|СОНКО|СОНО)/i;

// Что понятно из требований: процент обеспечения исполнения со строкой, где он написан,
// и закупка ли это только у малого бизнеса и СОНКО.
export function readRequirements(purchase: PurchaseLike): {
  securityPct: number | null;
  securityLine: string | null;
  smeOnly: boolean;
} {
  const items = Object.values(purchase.requirements).flat();
  let securityPct: number | null = null;
  let securityLine: string | null = null;
  let fromPrice = false;
  for (const item of items) {
    for (const text of [item.text, item.quote]) {
      const m: RegExpExecArray | null = securityPct === null ? SECURITY.exec(text) : null;
      if (!m || NEW_SENTENCE.test(m[1])) continue;
      securityPct = Number(m[2].replace(",", "."));
      securityLine = item.text;
      fromPrice = /от\s+цены\s+контракта/i.test(m[1] + m[3]);
    }
  }
  const smeOnly = fromPrice || items.some((item) => SME_ONLY.test(item.text) || SME_ONLY.test(item.quote));
  return { securityPct, securityLine, smeOnly };
}

// Антидемпинговые меры ст. 37 — только на конкурсе и аукционе по 44-ФЗ. По 223-ФЗ они — в положении о закупке заказчика.
export const antiDumpingApplies = (kind: string) => !/223/.test(kind) && !/котиров|единствен/i.test(kind);

// nmck — начальная цена из сведений о закупке (parseRubles): модуль без зависимостей, чтобы тесты шли прямо в node.
export function defaultsFor(purchase: PurchaseLike, nmck: number | null): PriceCalc {
  const found = readRequirements(purchase);
  return {
    nmck,
    costs: null,
    extra: null,
    taxPct: null,
    securityPct: found.securityPct,
    smeOnly: found.smeOnly,
    exempt: false,
    method: "guarantee",
    guaranteeRatePct: null,
    moneyRatePct: null,
    days: null,
    antiDumping: antiDumpingApplies(purchase.kind),
    goodFaith: false,
    price: purchase.tpPrice ?? null,
  };
}
