// Риски и расходы из проекта договора: что участник берёт на себя, подписав его. Читает код из текста документов, без ИИ: показываем только то, что в договоре написано,
// с цитатой, пунктом и числом. Выводы — «Подтверждено» (цитата есть в документе); оценка «много» или «долго» — только по порогам из RISK_RULES, которые видно и можно поменять.
// Что договор молчит или формулирует иначе, код не угадывает: это место для ИИ и юриста (раздел «Скрытые затраты» в плане аналитики).
//
// Находим: неустойку (кто платит и сколько), срок оплаты заказчиком, аванс, обеспечение исполнения, расходы, которые договор кладёт на исполнителя, и право заказчика менять объём.
// Не находим пока: субподряд, одностороннее расторжение, сроки исполнения (их читает after-win.ts), условия, из-за которых контракт может уйти в убыток.

import { isContract } from "@/lib/after-win";

type Doc = { name: string; text: string };

/** Пороги оценки — настройка, а не правда: меняются здесь. */
export const RISK_RULES = {
  /** Оплата заказчиком, дольше которой помечается «долго» (в календарных днях; рабочие умножаются на 7/5). */
  longPaymentDays: 30,
  /** Пеня за каждый день просрочки от этого процента — «крупная». */
  heavyPenaltyPerDayPct: 1,
  /** Штраф от этого процента цены или стоимости — «крупный». */
  heavyFinePct: 20,
  /** Обеспечение исполнения от этого процента цены — «высокое»: деньги или банковская гарантия под него ложатся на вас. */
  highSecurityPct: 10,
} as const;

export type RiskKind = "penalty" | "cost" | "payment" | "advance" | "security" | "volume";
/** you — платите вы; customer — платит заказчик; none — вопрос не про деньги сторон. */
export type RiskParty = "you" | "customer" | "none";

export type ContractRisk = {
  kind: RiskKind;
  party: RiskParty;
  /** Коротко: что именно и сколько. */
  title: string;
  /** warn — стоит учесть в цене или проверить; info — важно знать. */
  level: "warn" | "info";
  /** Крупная неустойка по порогам RISK_RULES. */
  heavy?: boolean;
  /** Предложение договора как написано, до 260 знаков. */
  quote: string;
  clause: string;
  doc: string;
};

const SUPPLIER = "(?:поставщик|подрядчик|исполнител|продав[еця])[а-яё]*";
const CUSTOMER = "(?:заказчик|покупател)[а-яё]*";
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const QUOTE_MAX = 260;
const shorten = (s: string) => (s.length > QUOTE_MAX ? `${s.slice(0, QUOTE_MAX - 1).trimEnd()}…` : s);
const CLAUSE = /^\s*((?:\d+\.)+\d*|\d+\))\s*/;

// Число с необязательным словом в скобках: «30 (тридцати)», «0,1 %», «5 (пять) процентов».
const PERCENT = /(\d+(?:[.,]\d+)?)\s*(?:\([^)]{0,40}\)\s*)?(?:%|процент[а-яё]*)/i;
const num = (s: string) => Number(s.replace(",", "."));
const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 4 }).replace(/[  ]/g, " ");

export const looksLikeContract = (doc: Doc) =>
  isContract(doc) || (/предмет\s+(?:договор|контракт|гпд)/i.test(doc.text) && /(?:права\s+и\s+обязанности|ответственность\s+сторон)/i.test(doc.text));

// ——— Неустойка ———

const PENALTY = /(?<![а-яё])(?:пен[яиеюь]|неустойк|штраф)/i;

function penaltyParty(s: string): RiskParty {
  if (new RegExp(`${SUPPLIER}\\s+(?:обязан\\s+|обязуется\\s+)?(?:уплат|уплач|выплат|выплач|оплат|оплач)`, "i").test(s)) return "you";
  if (new RegExp(`${CUSTOMER}\\s+(?:обязан\\s+)?(?:уплат|уплач|выплат|выплач)`, "i").test(s)) return "customer";
  if (new RegExp(`${CUSTOMER}\\s+вправе\\s+(?:требовать|потребовать|начисл|взыскать)`, "i").test(s)) return "you";
  if (new RegExp(`${SUPPLIER}\\s+вправе\\s+(?:требовать|потребовать|начисл|взыскать)`, "i").test(s)) return "customer";
  // «В случае просрочки исполнения Заказчиком / нарушения Заказчиком сроков оплаты» — нарушил заказчик, платит он.
  const breach = new RegExp(`(?:просрочк|нарушени|неисполнени|ненадлежащ)[а-яё]*[^.]{0,60}(${CUSTOMER.replace("[а-яё]*", "(?:ом|ем)")}|${SUPPLIER.replace("[а-яё]*", "(?:ом|ем|цом)")})`, "i").exec(s);
  if (breach) return /заказчик|покупател/i.test(breach[1]) ? "customer" : "you";
  return "none";
}

// Ставка: «1/300 ключевой ставки», «0,1 % … за каждый день», «0,01 %», «5 000 рублей» — и от чего считается («от цены ГПД», «от стоимости работ»).
function penaltyRate(s: string): { title: string; heavy: boolean } | null {
  const frac = /1\/(\d+)\s*(?:\([^)]*\)\s*)?(?:ключев|ставк|действующ)/i.exec(s);
  const pct = PERCENT.exec(s);
  const money = /(\d[\d\s ]{0,12}(?:[.,]\d{1,2})?)\s*(?:руб|₽)/i.exec(s);
  let rate = "";
  let percent = 0;
  if (frac) rate = `1/${frac[1]} ключевой ставки`;
  else if (pct) {
    percent = num(pct[1]);
    rate = `${fmt(percent)} %`;
  } else if (money) rate = `${clean(money[1])} ₽`;
  if (!rate) return null;
  const perDay = /(?:за\s+каждый\s+(?:день|календарный\s+день)|ежедневно|за\s+каждые?\s+сутки)/i.test(s);
  const word = perDay || /(?<![а-яё])пен[яиеюь]/i.test(s) ? "Пеня" : /штраф/i.test(s) ? "Штраф" : "Неустойка";
  // От чего считается: слова после ставки («от цены Договора», «от суммы неисполненных обязательств») — до запятой, точки с запятой или «за каждый».
  const after = pct ? s.slice(pct.index + pct[0].length) : frac ? s.slice(frac.index + frac[0].length) : "";
  const from = /^[^.;]{0,30}?(от\s+(?:[а-яё]+\s+){0,4}?(?:цен[а-яё]*|стоимост[а-яё]*|сумм[а-яё]*|задолженност[а-яё]*|долг[а-яё]*)(?:\s+(?!(?:за|но|и|в|не|по|при|либо|или)(?![а-яё]))[а-яё]+){0,2})/i.exec(after);
  const capMatch = /не\s+более\s+(\d+(?:[.,]\d+)?)\s*(?:\([^)]{0,40}\)\s*)?(?:%|процент)/i.exec(s);
  const parts = [`${word} ${rate}`, perDay ? "за каждый день просрочки" : "", from ? clean(from[1]) : "", capMatch ? `не более ${fmt(num(capMatch[1]))} % цены` : ""].filter(Boolean);
  const heavy = (perDay && percent >= RISK_RULES.heavyPenaltyPerDayPct) || (!perDay && percent >= RISK_RULES.heavyFinePct);
  return { title: parts.join(", "), heavy };
}

// ——— Срок оплаты ———

const WORD_NUMBERS: Record<string, number> = { трёх: 3, трех: 3, пяти: 5, семи: 7, восьми: 8, десяти: 10, пятнадцати: 15, двадцати: 20, тридцати: 30, сорока: 40, шестидесяти: 60 };
const TERM = /в\s+течени[ие]\s+(?:(\d+)|([а-яё]+))\s*(?:\([^)]{0,40}\)\s*)?(рабочих|календарных|банковских)?\s*дн/i;

const PAY_LEAD = /(?:оплат|перечисл|расч[её]т[а-яё]*\s+(?:производ|осуществ|проводят))/i;
const NOT_PAY = /(?:сообщ|уведом|направ|сверк|предостав|подпис|рассмотр|исправ|обеспечени)/i;

// ——— Аванс, обеспечение, объём ———

// Оговорки «в случае, если проект договора…», «если в соответствии с условиями…», «при этом…» — условие, а не условие этого договора: не берём.
const CONDITIONAL = /^(?:в\s+случае,?\s+(?:если|когда)|если|при\s+условии|при\s+этом|за\s+исключением)/i;

const NO_ADVANCE = /(?:аванс[а-яё]*|авансирование)[^.]{0,60}(?:не\s+предусмотрен|не\s+осуществля|не\s+выплачива|не\s+производ|не\s+предоставля)/i;
const ADVANCE = /аванс[а-яё]*[^.]{0,80}?(\d+(?:[.,]\d+)?)\s*(?:\([^)]{0,40}\)\s*)?(?:%|процент)/i;
const SECURITY_NONE = /обеспечени[а-яё]*\s+исполнени[а-яё]*[^.]{0,60}(?:не\s+установлен|не\s+требуется|не\s+предусмотрен)/i;
const SECURITY_SIZE = /обеспечени[а-яё]*\s+исполнени[а-яё]*[^.]{0,120}?(?:в\s+размере|размер[а-яё]*)[^.]{0,60}?(\d+(?:[.,]\d+)?)\s*(?:\([^)]{0,40}\)\s*)?(?:%|процент)/i;
const VOLUME = /(?:количеств|объ[её]м)[^.]{0,120}(?:измен|увелич|уменьш)[^.]{0,160}?(?:не\s+более|до)\s+(\d+(?:[.,]\d+)?)\s*(?:\([^)]{0,40}\)\s*)?(?:%|процент)/i;

// ——— Расходы исполнителя ———

const COST_ON_YOU = new RegExp(
  `(?:расход[а-яё]*|затрат[а-яё]*)[^.]{0,100}(?:нес[её]т|несут|возлагаются\\s+на|относятся\\s+на|осуществляются\\s+за\\s+счёт)\\s+${SUPPLIER}|за\\s+(?:свой\\s+)?счёт\\s+${SUPPLIER}|(?:экспертиз[а-яё]*|испытани[а-яё]*|сертификаци[а-яё]*)[^.]{0,60}?оплачива[а-яё]*\\s+${SUPPLIER}`,
  "i",
);
const COST_KINDS: [RegExp, string][] = [
  [/экспертиз/i, "экспертиза"],
  [/обеспечени|банковск[а-яё]*\s+гаранти|гаранти[а-яё]*\s+банк/i, "обеспечение (банковская гарантия)"],
  [/испытани|лаборатор|сертификац|поверк/i, "испытания и сертификация"],
  [/доставк|транспорт|перевоз/i, "доставка"],
  [/погрузк|разгрузк/i, "погрузка и разгрузка"],
  [/упаков|хранени/i, "упаковка и хранение"],
  [/страхован/i, "страхование"],
  [/монтаж|пусконаладк|шеф/i, "монтаж и пусконаладка"],
  [/обучени/i, "обучение"],
  [/утилизац|вывоз/i, "вывоз и утилизация"],
  [/устранени[а-яё]*\s+недостатк|гарантийн/i, "устранение недостатков и гарантия"],
];
const costKind = (s: string) => COST_KINDS.find(([re]) => re.test(s))?.[1] ?? "прочие расходы";

// ——— Разбор ———

type Sentence = { text: string; clause: string; doc: string };

function sentencesOf(doc: Doc): Sentence[] {
  const out: Sentence[] = [];
  for (const line of doc.text.split(/\n+/)) {
    const m = CLAUSE.exec(line);
    const clause = m ? m[1].replace(/\.$/, "") : "";
    for (const text of line.replace(CLAUSE, "").split(/(?<=\.)\s+(?=[А-ЯЁ«])/)) {
      const t = clean(text);
      if (t.length >= 25) out.push({ text: t, clause, doc: doc.name });
    }
  }
  return out;
}

const MAX_PER_KIND: Record<RiskKind, number> = { penalty: 8, cost: 8, payment: 4, advance: 2, security: 3, volume: 2 };

export function contractRisks(documents: Doc[]): ContractRisk[] {
  const found: ContractRisk[] = [];
  const seen = new Set<string>();
  const add = (s: Sentence, r: Omit<ContractRisk, "quote" | "clause" | "doc">) => {
    // Одна и та же оговорка в разных документах и разделах не повторяется.
    const key = `${r.kind}|${r.party}|${s.text.slice(0, 120)}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ ...r, quote: shorten(s.text), clause: s.clause, doc: s.doc });
  };

  for (const doc of documents.filter(looksLikeContract)) {
    for (const s of sentencesOf(doc)) {
      const t = s.text;

      if (PENALTY.test(t)) {
        const party = penaltyParty(t);
        const rate = penaltyRate(t);
        if (rate && party !== "none") {
          add(s, { kind: "penalty", party, level: party === "you" ? "warn" : "info", title: rate.title, ...(party === "you" && rate.heavy && { heavy: true }) });
        }
        continue;
      }

      if (COST_ON_YOU.test(t)) {
        add(s, { kind: "cost", party: "you", level: "warn", title: `Расходы за ваш счёт: ${costKind(t)}` });
        continue;
      }

      // Срок оплаты — только если в течение этого срока платит заказчик: «оплата производится… в течение 7 дней», а не «сообщить… в течение 3 дней» и не «сверку расчётов».
      const term = TERM.exec(t);
      const lead = term ? t.slice(Math.max(0, term.index - 120), term.index) : "";
      if (term && new RegExp(`${CUSTOMER}`, "i").test(t) && PAY_LEAD.test(lead) && !NOT_PAY.test(lead) && !new RegExp(`${SUPPLIER}\\s+оплачива`, "i").test(t) && !/возврат|неустойк|штраф|пен[яию]/i.test(t)) {
        const days = term[1] ? Number(term[1]) : (WORD_NUMBERS[term[2].toLowerCase()] ?? 0);
        if (days > 0) {
          const unit = term[3] ? `${term[3]} ` : "";
          const calendar = term[3] === "рабочих" ? Math.round((days * 7) / 5) : days;
          const base = /(?:с|со)\s+(?:даты|момента|дня)\s+[^.,;]{3,70}/i.exec(t)?.[0];
          add(s, {
            kind: "payment",
            party: "customer",
            level: calendar >= RISK_RULES.longPaymentDays ? "warn" : "info",
            title: `Оплата заказчиком в течение ${days} ${unit}дней${base ? ` ${clean(base)}` : ""}`,
          });
        }
        continue;
      }

      const conditional = CONDITIONAL.test(t);
      if (!conditional && NO_ADVANCE.test(t) && !/обеспечени|гаранти/i.test(t)) {
        add(s, { kind: "advance", party: "none", level: "info", title: "Аванса нет: исполнять придётся за свои деньги до оплаты" });
        continue;
      }
      const adv = ADVANCE.exec(t);
      if (!conditional && adv && !/возврат|корректировк|банковск[а-яё]*\s+гаранти|обеспечени/i.test(t)) {
        add(s, { kind: "advance", party: "none", level: "info", title: `Аванс ${fmt(num(adv[1]))} %` });
        continue;
      }

      if (!conditional && SECURITY_NONE.test(t)) {
        add(s, { kind: "security", party: "none", level: "info", title: "Обеспечение исполнения не установлено" });
        continue;
      }
      const sec = SECURITY_SIZE.exec(t);
      if (!conditional && sec) {
        const pctValue = num(sec[1]);
        add(s, { kind: "security", party: "you", level: pctValue >= RISK_RULES.highSecurityPct ? "warn" : "info", title: `Обеспечение исполнения: ${fmt(pctValue)} %` });
        continue;
      }

      const vol = VOLUME.exec(t);
      if (vol) add(s, { kind: "volume", party: "none", level: "info", title: `Объём может измениться до ${fmt(num(vol[1]))} %` });
    }
  }

  // Порядок: сначала то, что стоит денег, и сколько-то каждого вида, чтобы длинный договор не завалил список одним видом.
  const order: RiskKind[] = ["penalty", "cost", "payment", "advance", "security", "volume"];
  const kept: ContractRisk[] = [];
  for (const kind of order) {
    const items = found.filter((r) => r.kind === kind).sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1));
    kept.push(...items.slice(0, MAX_PER_KIND[kind]));
  }
  return kept;
}
