// Риски и расходы из проекта договора: что участник берёт на себя, подписав его. Читает код из текста документов, без ИИ: показываем только то, что в договоре написано,
// с цитатой, пунктом и числом. Выводы — «Подтверждено» (цитата есть в документе); оценка «много» или «долго» — только по порогам из RISK_RULES, которые видно и можно поменять.
// Что договор молчит или формулирует иначе, код не угадывает: это место для ИИ и юриста (раздел «Скрытые затраты» в плане аналитики).
//
// Находим: неустойку (кто платит и сколько), срок оплаты заказчиком, аванс, обеспечение исполнения, расходы, которые договор кладёт на исполнителя, право заказчика менять объём,
// срок поставки (даты или «в течение N дней»), удержание из платежей (гарантийный депозит), гарантийный срок и условия о стране происхождения (замена, запрет иностранных, постановления об ограничениях).
// Не находим пока: субподряд, одностороннее расторжение, условия, из-за которых контракт может уйти в убыток. Пустое место под число в проекте («не менее ____ месяцев») срока не называет — не берём.

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
  /** Гарантийный срок на товар или работы от стольких месяцев — «долгий»: резерв на ремонт и замену остаётся на вас. */
  longWarrantyMonths: 24,
} as const;

export type RiskKind = "penalty" | "cost" | "payment" | "price" | "advance" | "security" | "volume" | "delivery" | "retention" | "warranty" | "origin";
export const RISK_GROUPS: Record<RiskKind, string> = {
  penalty: "Неустойка",
  cost: "Расходы за ваш счёт",
  payment: "Оплата заказчиком",
  price: "Цена и её изменение",
  advance: "Аванс",
  security: "Обеспечение исполнения",
  volume: "Изменение объёма",
  delivery: "Срок поставки",
  retention: "Удержание из платежей",
  warranty: "Гарантийный срок",
  origin: "Страна происхождения",
};
/** you — платите вы; customer — платит заказчик; none — вопрос не про деньги сторон. */
export type RiskParty = "you" | "customer" | "none";

/** Числа из условия — для расчёта «сколько это может стоить» (lib/risk-estimate.ts). Только то, что написано в договоре. */
export type RiskNumbers = {
  /** Пеня или штраф: процент от цены; доля ключевой ставки (1/300 → frac 300); сумма в рублях. */
  percent?: number;
  frac?: number;
  rub?: number;
  perDay?: boolean;
  /** Потолок пени, % цены. */
  cap?: number;
  /** Срок оплаты заказчиком, календарных дней. */
  days?: number;
  /** Гарантийный срок, месяцев. */
  months?: number;
};

export type ContractRisk = {
  kind: RiskKind;
  party: RiskParty;
  /** Коротко: что именно и сколько. */
  title: string;
  /** warn — стоит учесть в цене или проверить; info — важно знать. */
  level: "warn" | "info";
  /** Крупная неустойка по порогам RISK_RULES. */
  heavy?: boolean;
  /** За что неустойка, если договор говорит прямо: «несоответствие страны происхождения», «нарушение сроков». */
  cause?: string;
  n?: RiskNumbers;
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

// За что неустойка — только по прямым словам договора, иначе не угадываем.
const CAUSES: [RegExp, string][] = [
  [/стран[а-яё]*\s+происхождени/i, "несоответствие страны происхождения"],
  [/нарушени[а-яё]*[^.]{0,30}срок/i, "нарушение сроков"],
  [/качеств|недостатк|брак/i, "ненадлежащее качество"],
];
const causeOf = (s: string) => CAUSES.find(([re]) => re.test(s))?.[1];

// Ставка: «1/300 ключевой ставки», «0,1 % … за каждый день», «0,01 %», «5 000 рублей» — и от чего считается («от цены ГПД», «от стоимости работ»).
function penaltyRate(s: string): { title: string; heavy: boolean; n: RiskNumbers } | null {
  const frac = /1\/(\d+)\s*(?:\([^)]*\)\s*)?(?:ключев|ставк|действующ)/i.exec(s);
  const pct = PERCENT.exec(s);
  // «50 000 (пятидесяти тысяч) рублей»: сумма цифрами, слова в скобках, потом «рублей».
  const money = /(\d[\d\s ]{0,12}(?:[.,]\d{1,2})?)\s*(?:\([^)]{0,60}\)\s*)?(?:руб|₽)/i.exec(s);
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
  const perCase = !perDay && /за\s+каждый\s+(?:случай|факт)/i.test(s);
  const parts = [`${word} ${rate}`, perDay ? "за каждый день просрочки" : "", perCase ? "за каждый случай нарушения" : "", from ? clean(from[1]) : "", capMatch ? `не более ${fmt(num(capMatch[1]))} % цены` : ""].filter(Boolean);
  const heavy = (perDay && percent >= RISK_RULES.heavyPenaltyPerDayPct) || (!perDay && percent >= RISK_RULES.heavyFinePct);
  const rubles = !frac && !pct && money ? num(clean(money[1]).replace(/[\s  ]/g, "")) : undefined;
  const n: RiskNumbers = { perDay, ...(frac && { frac: Number(frac[1]) }), ...(pct && !frac && { percent }), ...(rubles !== undefined && Number.isFinite(rubles) && { rub: rubles }), ...(capMatch && { cap: num(capMatch[1]) }) };
  return { title: parts.join(", "), heavy, n };
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
const SECURITY_LEAD = /^обеспечени[а-яё]*\s+исполнени[а-яё]*/i;
const PENALTY_RATE_WORDS = /(?:пен[яиеюь]|неустойк[а-яё]*|штраф[а-яё]*)\s+в\s+размере|за\s+каждый\s+(?:календарный\s+)?день/i;
const SECURITY_NONE =/обеспечени[а-яё]*\s+исполнени[а-яё]*[^.]{0,60}(?:не\s+установлен|не\s+требуется|не\s+предусмотрен)/i;
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

/** lead — вводная строка списка («Покупатель вправе потребовать уплаты Поставщиком:»): пункты списка сами о том, кто платит, молчат. */
type Sentence = { text: string; clause: string; doc: string; lead?: string };

const BULLET = /^\s*[–—•-]\s*\S/;

function sentencesOf(doc: Doc): Sentence[] {
  const out: Sentence[] = [];
  let lead: { text: string; clause: string } | null = null;
  for (const line of doc.text.split(/\n+/)) {
    const m = CLAUSE.exec(line);
    const clause = m ? m[1].replace(/\.$/, "") : "";
    const bullet = !m && BULLET.test(line);
    if (!bullet) lead = null;
    const items = line.replace(CLAUSE, "").split(/(?<=\.)\s+(?=[А-ЯЁ«])/);
    for (const text of items) {
      const t = clean(text);
      if (t.length < 25) continue;
      out.push(bullet && lead ? { text: t, clause: lead.clause, doc: doc.name, lead: lead.text } : { text: t, clause, doc: doc.name });
    }
    // Вводная строка списка кончается двоеточием: следующие строки с тире — её пункты.
    if (!bullet && /:\s*$/.test(line)) lead = { text: clean(line.replace(CLAUSE, "")), clause };
  }
  return out;
}

const MAX_PER_KIND: Record<RiskKind, number> = { penalty: 8, cost: 8, payment: 4, price: 4, advance: 2, security: 3, volume: 2, delivery: 3, retention: 2, warranty: 3, origin: 3 };

// ——— Срок поставки, удержание, гарантийный срок, страна происхождения ———

// Гарантийный срок: «составляет 24 месяца», «устанавливается равным не менее 12 (двенадцати) месяцев». Пустое место под число («не менее ____ ( ) месяцев») срока не называет — не берём.
const WARRANTY = /гарантийн[а-яё]*\s+срок[а-яё]*[^.]{0,120}?(?:(?:составля|устанавлива|равн)[а-яё]*\s+){1,2}(?:не\s+менее\s+)?(\d+)\s*(?:\([^)]{0,40}\)\s*)?(?:календарных\s+)?(месяц[а-яё]*|лет|год[а-яё]*)/i;
// «Не возражает против удержания из платежей, причитающихся Поставщику, денежной суммы в размере не менее 10 % от стоимости» (гарантийный депозит): часть денег придерживается до конца срока.
const RETENTION = /удержани[а-яё]*\s+из\s+(?:платеж|сумм|оплат)[а-яё]*[^.]{0,160}?(\d+(?:[.,]\d+)?)\s*(?:\([^)]{0,40}\)\s*)?(?:%|процент)/i;
// Страна происхождения: «не вправе произвести замену страны происхождения Товара, за исключением … вместо иностранного Товара поставляется российский»; ссылка на постановление об ограничениях иностранного; прямой запрет.
const ORIGIN_SWAP = /не\s+вправе\s+(?:произвести\s+)?замен[а-яё]*\s+стран[а-яё]*\s+происхождения/i;
const ORIGIN_DECREE = /постановлени[а-яё]*\s+правительства[^№]{0,80}?№\s*(1875|878|617|102|1289|925|1236|616)(?!\d)/i;
const ORIGIN_WORDS = /запрет|ограничени|приоритет|допуск|преимуществ|происхожд|иностран/i;
const ORIGIN_BAN = new RegExp(String.raw`(?:запрещ[а-яё]*|не\s+допуска[а-яё]*)[^.]{0,80}?(?:иностранн[а-яё]*\s+(?:товар|продукц|происхожден)|происходящ[а-яё]*\s+из\s+иностранн[а-яё]*)|(?:иностранн[а-яё]*\s+(?:товар|продукц|происхожден)|происходящ[а-яё]*\s+из\s+иностранн[а-яё]*)[^.]{0,80}?(?:запрещ[а-яё]*|не\s+допуска[а-яё]*)`, "i");
// Срок поставки: «Общий срок поставки Товара: с момента заключения Договора по 30.12.2027»; «Поставщик обязуется поставить Товар … в течение 15 (пятнадцати) календарных дней с момента направления Заказа».
const DELIVERY_DATE = /срок[а-яё]*\s+(?:поставки|выполнения\s+работ|оказания\s+услуг)(?:\s+(?:товара|работ|услуг))?\s*(?:[:–—-]|составляет|устанавливается)?\s*((?:с\s+[^.]{3,60}?\s+)?(?:по|до|не\s+позднее)\s+\d{1,2}\.\d{2}\.\d{4})/i;
const DELIVERY_DAYS = /(?:обязу[а-яё]*\s+поставить|поставк[а-яё]*)[^.]{0,100}?(?:в\s+течени[ие]|составляет)\s+(\d+)\s*(?:\([^)]{0,40}\)\s*)?(календарных|рабочих|банковских)?\s*дн[а-яё]*(\s+(?:с|со)\s+(?:даты|момента|дня)\s+[^.,;]{3,70})?/i;
// Это не срок поставки: ремонт и замена, недостатки, оплата и ответственность.
const NOT_DELIVERY = /ремонт|замен|недостат|устран|гарант|отзыв|вывез|претензи|уведомл|подтвержд|оплат|оплач|платеж|аванс|сч[её]т|расч[её]т|пеня|пени|неустойк|штраф|возврат/i;

// ——— Цена: твёрдая или можно менять ———

// «Цена является твёрдой», «Стоимость Работ не подлежит корректировке»: рост цен на материалы, топливо и труд — риск исполнителя; исключения договор пишет рядом («за исключением…»).
const PRICE_FIXED = /(?:цен[а-яё]*|стоимост[а-яё]*)[^.]{0,80}?(?:тв[её]рд[а-яё]*|фиксированн[а-яё]*|окончательн[а-яё]*|не\s+подлежит\s+(?:изменени|корректировк|пересмотр))/i;
// «Поставщик вправе осуществлять индексацию цены», «Изменение цены договора возможно…», «Цена Договора может быть увеличена…»: договор сам даёт способ изменить цену.
const PRICE_REVISION = /(?:индексаци[а-яё]*\s+цен|корректировк[а-яё]*\s+(?:цен|суммы\s+ндс|в\s+части\s+суммы\s+ндс)|изменени[а-яё]*\s+цен[а-яё]*[^.]{0,80}?возможн|изменени[а-яё]*\s+цен[а-яё]*\s+(?:договор|контракт)[а-яё]*\s+при\s+изменении\s+ставки|цен[а-яё]*\s+(?:договор|контракт)[а-яё]*\s+может\s+быть\s+(?:увеличен|изменен|изменён|скорректирован|пересмотрен))/i;

function priceRevisionTitle(t: string): string {
  const parts: string[] = [];
  if (/индексаци/i.test(t)) {
    const every = /не\s+реже\s+одного\s+раза\s+в\s+(\d+)\s*(?:\([^)]*\)\s*)?(месяц|квартал|год)/i.exec(t);
    parts.push(`индексация${/индекс[а-яё]*\s+потребительских\s+цен/i.test(t) ? " по индексам потребительских цен" : ""}${every ? `, не реже раза в ${every[1]} ${every[2] === "год" ? "лет" : every[2] === "квартал" ? "квартала" : "мес."}` : ""}`);
  }
  if (/(?<![а-яё])ндс/i.test(t)) parts.push("при изменении ставки НДС");
  if (/ограничительн/i.test(t)) parts.push("при введении ограничительных мер");
  const volume = /не\s+более\s+(?:чем\s+на\s+)?(\d+(?:[.,]\d+)?)\s*(?:\([^)]{0,40}\)\s*)?(?:%|процент)/i.exec(t);
  if (volume && /объ[её]м|количеств/i.test(t)) parts.push(`при изменении объёма до ${fmt(num(volume[1]))} %`);
  if (/стать[а-яё]*\s+95|част[а-яё]*\s+65/i.test(t)) parts.push("в случаях, установленных статьёй 95 44-ФЗ");
  return `Договор допускает изменение цены${parts.length ? `: ${parts.join("; ")}` : ""}`;
}

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

      // «Обеспечение исполнения … в размере 5 % цены … подлежит возврату … включая оплату неустойки (пеней, штрафов)»: слова о неустойке здесь — условие возврата денег, а не ставка.
      if (SECURITY_LEAD.test(t) && !PENALTY_RATE_WORDS.test(t) && !CONDITIONAL.test(t)) {
        const size = PERCENT.exec(t);
        if (size) {
          const pctValue = num(size[1]);
          add(s, { kind: "security", party: "you", level: pctValue >= RISK_RULES.highSecurityPct ? "warn" : "info", title: `Обеспечение исполнения: ${fmt(pctValue)} %`, n: { percent: pctValue } });
          continue;
        }
      }

      if (PENALTY.test(t)) {
        // Пункт списка («– неустойки в размере 0,1 % … за каждый день просрочки») — кто платит, сказано во вводной строке.
        let party = penaltyParty(t);
        if (party === "none" && s.lead) party = penaltyParty(`${s.lead} ${t}`);
        const rate = penaltyRate(t);
        if (rate && party !== "none") {
          // Пеня за день просрочки сама говорит, за что она; причина нужна штрафам.
          const cause = rate.n.perDay ? undefined : causeOf(t);
          add(s, { kind: "penalty", party, level: party === "you" ? "warn" : "info", title: rate.title, n: rate.n, ...(party === "you" && rate.heavy && { heavy: true }), ...(cause && { cause }) });
        }
        continue;
      }

      // Эти четыре условия не прерывают разбор: то же предложение может быть и расходом, и ценой.
      const ret = RETENTION.exec(t);
      if (ret && !/аванс/i.test(t)) {
        const pctValue = num(ret[1]);
        add(s, { kind: "retention", party: "you", level: "warn", title: `Из платежей удерживается ${/не\s+менее/i.test(ret[0]) ? "не менее " : ""}${fmt(pctValue)} %${/гарантийн[а-яё]*\s+депозит/i.test(t) ? " (гарантийный депозит)" : ""}`, n: { percent: pctValue } });
      }
      const warranty = WARRANTY.exec(t);
      if (warranty) {
        const months = /^(?:лет|год)/i.test(warranty[2]) ? Number(warranty[1]) * 12 : Number(warranty[1]);
        if (months > 0 && months <= 120) add(s, { kind: "warranty", party: "you", level: months >= RISK_RULES.longWarrantyMonths ? "warn" : "info", title: `Гарантийный срок: ${months} мес.`, n: { months } });
      }
      if (ORIGIN_SWAP.test(t)) {
        add(s, { kind: "origin", party: "you", level: "info", title: "Страну происхождения менять нельзя; исключение — вместо иностранного товара российский" });
      } else if (ORIGIN_BAN.test(t)) {
        add(s, { kind: "origin", party: "you", level: "warn", title: "Договор запрещает иностранные товары" });
      } else {
        const decree = ORIGIN_DECREE.exec(t);
        if (decree && ORIGIN_WORDS.test(t)) add(s, { kind: "origin", party: "you", level: /запрет|не\s+допуска/i.test(t) ? "warn" : "info", title: `Ограничения для иностранных товаров: постановление № ${decree[1]}` });
      }
      if (!NOT_DELIVERY.test(t)) {
        const date = DELIVERY_DATE.exec(t);
        const days = DELIVERY_DAYS.exec(t);
        if (date) add(s, { kind: "delivery", party: "none", level: "info", title: `Срок поставки: ${clean(date[1])}` });
        else if (days && Number(days[1]) > 0) {
          const calendar = days[2] === "рабочих" ? Math.round((Number(days[1]) * 7) / 5) : Number(days[1]);
          add(s, { kind: "delivery", party: "none", level: "info", title: `Поставка в течение ${days[1]} ${days[2] ? `${days[2]} ` : ""}дн.${days[3] ? ` ${clean(days[3])}` : ""}`, n: { days: calendar } });
        }
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
            n: { days: calendar },
          });
        }
        continue;
      }

      // Цена: «твёрдая» — рост цен за срок на вас; «можно менять» — договор сам даёт способ (индексация, изменение объёма, ставка НДС).
      if (PRICE_REVISION.test(t) && !/снижен|уменьш/i.test(t)) {
        add(s, { kind: "price", party: "none", level: "info", title: priceRevisionTitle(t) });
        continue;
      }
      if (PRICE_FIXED.test(t) && !/субподрядчик|соисполнител/i.test(t)) {
        add(s, { kind: "price", party: "you", level: "warn", title: `Цена твёрдая: рост цен на материалы, топливо и труд — ваш риск${/за\s+исключением/i.test(t) ? " (договор называет исключения)" : ""}` });
        continue;
      }

      const conditional = CONDITIONAL.test(t);
      if (!conditional && NO_ADVANCE.test(t) && !/обеспечени|гаранти/i.test(t)) {
        add(s, { kind: "advance", party: "none", level: "info", title: "Аванса нет: исполнять придётся за свои деньги до оплаты" });
        continue;
      }
      const adv = ADVANCE.exec(t);
      if (!conditional && adv && !/возврат|корректировк|банковск[а-яё]*\s+гаранти|обеспечени/i.test(t)) {
        add(s, { kind: "advance", party: "none", level: "info", title: `Аванс ${fmt(num(adv[1]))} %`, n: { percent: num(adv[1]) } });
        continue;
      }

      if (!conditional && SECURITY_NONE.test(t)) {
        add(s, { kind: "security", party: "none", level: "info", title: "Обеспечение исполнения не установлено" });
        continue;
      }
      const sec = SECURITY_SIZE.exec(t);
      if (!conditional && sec) {
        const pctValue = num(sec[1]);
        add(s, { kind: "security", party: "you", level: pctValue >= RISK_RULES.highSecurityPct ? "warn" : "info", title: `Обеспечение исполнения: ${fmt(pctValue)} %`, n: { percent: pctValue } });
        continue;
      }

      const vol = VOLUME.exec(t);
      if (vol) add(s, { kind: "volume", party: "none", level: "info", title: `Объём может измениться до ${fmt(num(vol[1]))} %`, n: { percent: num(vol[1]) } });
    }
  }

  // Порядок: сначала то, что стоит денег, и сколько-то каждого вида, чтобы длинный договор не завалил список одним видом.
  const order: RiskKind[] = ["penalty", "cost", "retention", "payment", "price", "advance", "security", "warranty", "origin", "delivery", "volume"];
  const kept: ContractRisk[] = [];
  for (const kind of order) {
    const items = found.filter((r) => r.kind === kind).sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1));
    kept.push(...items.slice(0, MAX_PER_KIND[kind]));
  }
  return kept;
}
