// Матрица из 27 проверок закупки (шаг 6 плана «Аналитика»; четыре группы из задания владельца: конкуренция 6, финансы 7, квалификация 6, надёжность и договорные риски 8).
// У каждой проверки — описание, источник данных, правило оценки и результат: «в порядке», «внимание», «риск» либо «недостаточно данных» / «не проверено». Баллов без данных не бывает.
// Программа считает 15 проверок из того, что уже есть (договор, расчёт цены, РИЦ, требования заказчика и база доказательств компании); 12 ждут внешних данных (ЕИС, суды, ФАС) — пока их нет,
// участник может записать результат своей проверки сам, он помечается «проверено вами». Итог — не процент победы, а счёт: сколько проверено, сколько в порядке, сколько внимания и риска;
// риск, который описывают несколько проверок (например, долгая оплата), считается один раз (у проверок общая «тема»). Важность каждой проверки меняется. Все пороги — из RISK_RULES (contract-risks.ts).

import { RISK_RULES, looksLikeContract, type ContractRisk } from "@/lib/contract-risks";
import type { EconResult } from "@/lib/economics";
import { EVIDENCE_TEXT, type Check, type PurchaseCheck } from "@/lib/evidence-match";
import type { RicResult } from "@/lib/indicative-price";
import { isNoncompetitiveSme, isSingleSupplier } from "@/lib/law-kind";
import type { PriceBadge } from "@/lib/price-badge";
import type { RegistryDemand } from "@/lib/registry-demand";
import type { EstimateResult } from "@/lib/risk-estimate";
import { percent, rubles } from "@/lib/analytics-summary";

export type GroupId = "competition" | "finance" | "qualification" | "reliability";
export type Level = "ok" | "attention" | "risk";

export const GROUPS: { id: GroupId; title: string; note: string }[] = [
  { id: "competition", title: "Конкуренция", note: "Сколько и кто соревнуется; доступность процедуры." },
  { id: "finance", title: "Финансовые условия", note: "Цена, обеспечение, оплата, штрафы, прибыль." },
  { id: "qualification", title: "Квалификация", note: "Что требует заказчик от участника и что подтверждено у вас." },
  { id: "reliability", title: "Надёжность и договорные риски", note: "Как заказчик исполняет контракты и что в договоре." },
];

export const LEVEL_TEXT: Record<Level, string> = { ok: "В порядке", attention: "Внимание", risk: "Риск" };

export type CheckDef = {
  n: number;
  group: GroupId;
  title: string;
  /** Что проверяется, простыми словами. */
  what: string;
  /** Откуда берутся данные. */
  source: string;
  /** По какому правилу ставится результат. */
  rule: string;
  /** Общая тема: проверки с одной темой описывают один риск и в счёте считаются вместе. */
  topic: string;
  /** Важность по умолчанию, 1–3: от неё зависит порядок «что смотреть первым». */
  weight: 1 | 2 | 3;
  /** false — данных в программе нет, результат проверки вносит участник. */
  computed: boolean;
};

const EXTERNAL = "Пока нет источника в программе: ";

export const CHECKS: CheckDef[] = [
  { n: 1, group: "competition", title: "Число участников в похожих закупках", what: "Сколько заявок подавали на похожие закупки: чем больше, тем жёстче борьба за цену.", source: "ЕИС: протоколы рассмотрения заявок по тем же ОКПД2 и КТРУ.", rule: "Среднее и медиана числа допущенных заявок по похожим закупкам; оценка — при достаточном числе наблюдений.", topic: "competition", weight: 1, computed: false },
  { n: 2, group: "competition", title: "Динамика конкуренции у заказчика", what: "Растёт или падает число участников у этого заказчика по годам.", source: "ЕИС: закупки заказчика по периодам.", rule: "Тенденция числа участников за несколько лет; нужно не меньше трёх периодов.", topic: "competition", weight: 1, computed: false },
  { n: 3, group: "competition", title: "История победителей", what: "Кто выигрывал у заказчика и с каким снижением цены.", source: "ЕИС: протоколы подведения итогов и реестр контрактов.", rule: "Состав победителей и среднее и медианное снижение цены за период, с числом наблюдений.", topic: "winners", weight: 1, computed: false },
  { n: 4, group: "competition", title: "Повторяемость побед одних и тех же поставщиков", what: "Выигрывают ли у заказчика одни и те же поставщики.", source: "ЕИС: реестр контрактов заказчика.", rule: "Доля контрактов у самых частых победителей; сам факт повторов выводом о нарушениях не считается.", topic: "winners", weight: 1, computed: false },
  { n: 5, group: "competition", title: "Конкурентная ситуация в отрасли и регионе", what: "Сколько поставщиков работает в вашей отрасли и в регионе поставки.", source: "ЕИС и открытые данные ФНС: число поставщиков по ОКПД2 и региону.", rule: "Число активных поставщиков и динамика за период.", topic: "competition", weight: 1, computed: false },
  { n: 6, group: "competition", title: "Особенности процедуры, влияющие на доступность участия", what: "Способ закупки и условия, из-за которых участвовать могут не все: единственный поставщик, закупка среди МСП, закрытый способ, реестровый номер товара.", source: "Извещение и документы закупки, профиль компании.", rule: "Внимание — если участие ограничено и из профиля не видно, что вы подходите; в порядке — ограничений в документах не найдено.", topic: "access", weight: 2, computed: true },
  { n: 7, group: "finance", title: "Соответствие начальной цены рыночному уровню", what: "Насколько начальная цена заказчика отличается от рыночного ориентира (РИЦ).", source: "Ваши цены-аналоги в блоке РИЦ.", rule: "Бейдж цены: нужно не меньше пяти сопоставимых цен; «ниже» или «выше рынка» — внимание, «в рынке» — в порядке, иначе — недостаточно данных.", topic: "price", weight: 3, computed: true },
  { n: 8, group: "finance", title: "Размер обеспечения заявки", what: "Сколько денег замораживается на время закупки, пока заявка участвует.", source: "Извещение и документы закупки; расчёт прибыли.", rule: "Сумма сравнивается с вашей ожидаемой прибылью в базовом сценарии: больше прибыли — внимание.", topic: "security-bid", weight: 2, computed: true },
  { n: 9, group: "finance", title: "Размер обеспечения исполнения контракта", what: "Сколько нужно внести под гарантию исполнения и сколько это стоит.", source: "Проект договора, расчёт стоимости гарантии.", rule: "Внимание — если процент не меньше порога «высокое обеспечение» из методики (RISK_RULES).", topic: "security", weight: 2, computed: true },
  { n: 10, group: "finance", title: "Сроки оплаты и аванс", what: "Через сколько дней заказчик платит и есть ли аванс.", source: "Проект договора.", rule: "Внимание — если срок оплаты не меньше порога «долго» из методики (RISK_RULES) или аванса нет при долгой оплате.", topic: "payment", weight: 2, computed: true },
  { n: 11, group: "finance", title: "Штрафы, пени и финансовые обязательства", what: "Что и в каком размере платите вы за просрочку и нарушения.", source: "Проект договора.", rule: "Риск — крупная неустойка на вас по порогам методики; внимание — неустойка с отметкой «стоит учесть»; в порядке — условия умеренные.", topic: "penalties", weight: 3, computed: true },
  { n: 12, group: "finance", title: "Влияние условий исполнения на оборотный капитал", what: "Сколько своих денег вы вложите до оплаты заказчиком и сколько это стоит.", source: "Срок оплаты и аванс из договора, ваши затраты, допущения расчёта.", rule: "Внимание — если свои деньги нужны на срок не меньше порога «долго» из методики и аванса нет; считается по вашим затратам.", topic: "payment", weight: 2, computed: true },
  { n: 13, group: "finance", title: "Ожидаемая рентабельность и устойчивость заявки", what: "Хватит ли прибыли: в базовом и в стрессовом сценарии.", source: "Блок «Какую цену ставить» (ваши затраты, налог, обеспечение, риски по договору).", rule: "Риск — убыток в базовом сценарии; внимание — убыток только в стрессовом или целевая маржа недостижима; в порядке — прибыль в обоих.", topic: "economics", weight: 3, computed: true },
  { n: 14, group: "qualification", title: "Наличие необходимого опыта", what: "Есть ли у вас исполненные договоры, которые просит заказчик.", source: "Требования заказчика и база доказательств компании.", rule: "Худший статус среди требований об опыте: нет доказательства, не подходит или просрочено — риск; скоро истечёт или решает человек — внимание.", topic: "qual-experience", weight: 3, computed: true },
  { n: 15, group: "qualification", title: "Соответствие требованиям к лицензиям", what: "Есть ли лицензии, которых требует заказчик, и действуют ли они на дату подачи.", source: "Требования заказчика и база доказательств компании.", rule: "Как в проверке об опыте, по требованиям о лицензиях.", topic: "qual-license", weight: 3, computed: true },
  { n: 16, group: "qualification", title: "Членство в СРО и специальные допуски", what: "Нужны ли СРО или допуски и подтверждены ли они.", source: "Требования заказчика и база доказательств компании.", rule: "Как в проверке об опыте, по требованиям о СРО и допусках.", topic: "qual-sro", weight: 3, computed: true },
  { n: 17, group: "qualification", title: "Выручка и финансовые показатели", what: "Подтверждены ли финансовые показатели, которых просит заказчик.", source: "Требования заказчика и база доказательств компании (финансовые данные).", rule: "Как в проверке об опыте, по требованиям о выручке и отчётности.", topic: "qual-finance", weight: 2, computed: true },
  { n: 18, group: "qualification", title: "Персонал и оборудование", what: "Есть ли специалисты и оборудование, которых требует заказчик.", source: "Требования заказчика и база доказательств компании.", rule: "Как в проверке об опыте, по требованиям о персонале, квалификации и оборудовании.", topic: "qual-staff", weight: 2, computed: true },
  { n: 19, group: "qualification", title: "Сертификаты и обязательные подтверждения", what: "Есть ли сертификаты и свидетельства, которых требует заказчик.", source: "Требования заказчика и база доказательств компании.", rule: "Как в проверке об опыте, по требованиям о сертификатах.", topic: "qual-certificate", weight: 2, computed: true },
  { n: 20, group: "reliability", title: "История исполнения контрактов заказчиком", what: "Как заказчик исполняет свои контракты: платит ли, принимает ли работу.", source: "ЕИС: реестр контрактов (исполнение, оплата).", rule: "Доля контрактов, исполненных без нарушений, за период, с числом наблюдений.", topic: "customer-history", weight: 2, computed: false },
  { n: 21, group: "reliability", title: "Судебные споры и договорные конфликты", what: "Были ли суды у заказчика с поставщиками и о чём.", source: "Картотека арбитражных дел (КАД), по ИНН заказчика.", rule: "Роль заказчика, тип требований, стадия и исход; иск не считается доказанной задолженностью, число дел само по себе вывода не даёт.", topic: "customer-courts", weight: 2, computed: false },
  { n: 22, group: "reliability", title: "Жалобы и решения ФАС", what: "Были ли жалобы на закупки заказчика и что решила служба.", source: "ЕИС и сайт ФАС: решения по жалобам.", rule: "Число и содержание решений по заказчику; выводы формулируются как факты и основания.", topic: "customer-fas", weight: 1, computed: false },
  { n: 23, group: "reliability", title: "Расторжения и существенные изменения контрактов", what: "Как часто заказчик расторгал контракты или менял их условия.", source: "ЕИС: реестр контрактов (расторжения, изменения).", rule: "Доля расторгнутых и изменённых контрактов за период, с числом наблюдений.", topic: "customer-history", weight: 2, computed: false },
  { n: 24, group: "reliability", title: "Признаки задержек оплаты", what: "Есть ли подтверждённые данные о том, что заказчик платит поздно.", source: "Картотека арбитражных дел и данные ЕИС об оплате.", rule: "Только подтверждённые факты (решения, акты); предположения в оценку не идут.", topic: "customer-payment", weight: 2, computed: false },
  { n: 25, group: "reliability", title: "Финансовые проблемы и юридический статус заказчика", what: "Действует ли заказчик, нет ли банкротства, ликвидации или смены владельца.", source: "ЕГРЮЛ, ЕФРСБ и картотека арбитражных дел, по ИНН и ОГРН заказчика.", rule: "Статус и сведения о процедурах; заказчик определяется по ИНН и ОГРН, не по названию.", topic: "customer-status", weight: 2, computed: false },
  { n: 26, group: "reliability", title: "Односторонний отказ, приёмка и взыскание неустойки", what: "Что в договоре позволяет заказчику отказаться от контракта, как устроена приёмка и кто платит за экспертизу.", source: "Проект договора.", rule: "Найденные условия показываются с цитатой и пунктом: внимание — условие есть; риск — вместе с крупной неустойкой на вас.", topic: "termination", weight: 2, computed: true },
  { n: 27, group: "reliability", title: "Признаки непрозрачной конкуренции", what: "Признаки того, что участники закупок у заказчика повторяются или координируются.", source: "ЕИС: протоколы и контракты; решения ФАС.", rule: "Только проверяемые факты; вывод о нарушении программа не делает.", topic: "winners", weight: 1, computed: false },
];

export const DEFAULT_WEIGHTS: Record<number, 1 | 2 | 3> = Object.fromEntries(CHECKS.map((c) => [c.n, c.weight]));

export type ManualResult = { level: Level; note: string; source: string };

export type CheckResult =
  | { state: "checked"; level: Level; summary: string; facts: string[] }
  | { state: "manual"; level: Level; summary: string; source: string }
  | { state: "insufficient"; summary: string; missing: string[] }
  | { state: "not_checked"; summary: string; missing: string[] };

export type CheckRow = { def: CheckDef; result: CheckResult; weight: 1 | 2 | 3 };

export type MatrixInput = {
  kind: string;
  /** Тексты документов закупки: из них читаются обеспечение заявки и условия договора. */
  docs: { name: string; text: string }[];
  hasContract: boolean;
  risks: ContractRisk[];
  estimate: EstimateResult;
  econ: EconResult;
  badge: PriceBadge | null;
  ric: RicResult | null;
  nmck: number | null;
  /** Закупка только для субъектов МСП (по документам). */
  smeOnly: boolean;
  /** В профиле указана категория МСП. */
  companySme: boolean;
  registry: RegistryDemand | null;
  /** Требования заказчика, сверенные с базой доказательств компании; null — ещё не посчитано. */
  evidence: PurchaseCheck[] | null;
  /** Что участник записал сам по проверкам, которых программа не считает, и свои веса. */
  manual?: Record<number, ManualResult>;
  weights?: Record<number, number>;
};

const checked = (level: Level, summary: string, facts: string[] = []): CheckResult => ({ state: "checked", level, summary, facts });
const insufficient = (summary: string, ...missing: string[]): CheckResult => ({ state: "insufficient", summary, missing });
const WORST: Record<Level, number> = { ok: 0, attention: 1, risk: 2 };
const worstOf = (levels: Level[]): Level => levels.reduce((a, b) => (WORST[b] > WORST[a] ? b : a), "ok" as Level);
const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
// Предложения: номер пункта («11.2.») остаётся при своём тексте и попадает в цитату — по нему находят место в документе.
const CLAUSE_GAP = "\u0001";
const sentences = (text: string) =>
  text
    .split(/\n+/)
    .flatMap((line) =>
      line
        .replace(/(\d+(?:\.\d+)*)\.\s+(?=[А-ЯЁA-Z«"(])/g, `$1.${CLAUSE_GAP}`)
        .split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«"])/)
        .map((s) => s.split(CLAUSE_GAP).join(" ").replace(/\s+/g, " ").trim()),
    )
    .filter(Boolean);
const clauseOf = (s: string) => /^(\d+(?:\.\d+){0,3})\.?\s/.exec(s)?.[1] ?? "";

type Found = { quote: string; doc: string; clause: string };

function findSentences(docs: MatrixInput["docs"], re: RegExp, limit = 3): Found[] {
  const out: Found[] = [];
  for (const d of docs) {
    for (const s of sentences(d.text)) {
      if (re.test(s)) out.push({ quote: clip(s), doc: d.name, clause: clauseOf(s) });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

const where = (f: Found) => `${f.clause ? `п. ${f.clause}, ` : ""}${f.doc}`;

// ——— Расчёт проверок ———

function procedure(i: MatrixInput): CheckResult {
  if (!i.kind.trim() && i.docs.length === 0) return insufficient("Способ закупки и документы не прочитаны.", "извещение и документы закупки");
  const facts: string[] = [];
  if (isSingleSupplier(i.kind)) facts.push("Закупка у единственного поставщика: конкурентной процедуры нет, заявки не подаются.");
  if (i.smeOnly || isNoncompetitiveSme(i.kind)) {
    facts.push(i.companySme ? "Закупка для субъектов МСП; в профиле указана категория МСП — подходите." : "Закупка для субъектов МСП, а в профиле категория МСП не указана: если вы не МСП, участвовать нельзя.");
  }
  if (/закрыт/i.test(i.kind)) facts.push("Закрытый способ: участвуют только приглашённые заказчиком — проверьте, что вы в списке.");
  if (i.registry?.status === "found") facts.push(`Нужен реестровый номер товара (национальный режим): «${clip(i.registry.mentions.find((m) => m.role === "requirement")?.quote ?? i.registry.mentions[0]?.quote ?? "", 140)}».`);
  if (facts.length === 0) return checked("ok", "Ограничений на участие в документах не найдено.", [`Способ: ${i.kind || "не указан"}.`]);
  const smeUnknown = (i.smeOnly || isNoncompetitiveSme(i.kind)) && !i.companySme;
  return checked(smeUnknown || isSingleSupplier(i.kind) || /закрыт/i.test(i.kind) || i.registry?.status === "found" ? "attention" : "ok", facts[0], facts);
}

function marketPrice(i: MatrixInput): CheckResult {
  const b = i.badge;
  if (!b) return insufficient("Цен-аналогов нет, рыночный ориентир не рассчитан.", "цены-аналоги в блоке РИЦ — не меньше пяти сопоставимых");
  if (b.status === "insufficient") return insufficient("Для оценки цены недостаточно сопоставимых цен.", ...(b.missing.length > 0 ? b.missing : ["не меньше пяти сопоставимых цен с источником и датой"]));
  const d = b.detail;
  const facts = d
    ? [
        `Начальная цена ${rubles(d.nmck)}, рыночная медиана ${rubles(d.median)}, РИЦ ${rubles(d.ric)}; отклонение ${rubles(d.abs)} (${percent(d.pct)}).`,
        `Сопоставимых цен: не меньше ${d.observations.min} по позиции, всего ${d.observations.total}.`,
      ]
    : [];
  return checked(b.status === "within" ? "ok" : "attention", b.title + ".", facts);
}

const BID = /обеспечени[а-яё]*\s+(?:заявк|заявок)|обеспечени[а-яё]*\s+участи[а-яё]*\s+в\s+(?:закупк|электронн|конкурс|аукцион)/i;

function bidSecurity(i: MatrixInput): CheckResult {
  if (isSingleSupplier(i.kind)) return checked("ok", "Закупка у единственного поставщика: заявка не подаётся, обеспечения заявки нет.");
  const found = findSentences(i.docs, new RegExp(`(?=.*(?:${BID.source}))(?=.*(?:\\d\\s*(?:%|процент)|\\d\\s*(?:руб|₽)))`, "i"), 2);
  if (found.length === 0) return insufficient("Размер обеспечения заявки в документах не найден.", "размер обеспечения заявки (извещение, документация)");
  const f = found[0];
  const pct = /(\d+(?:[.,]\d+)?)\s*(?:%|процент)/.exec(f.quote);
  const rub = /(\d[\d\s ]*(?:[.,]\d+)?)\s*(?:руб|₽)/.exec(f.quote);
  const amount = rub ? Number(rub[1].replace(/[\s ]/g, "").replace(",", ".")) : pct && i.nmck ? (i.nmck * Number(pct[1].replace(",", "."))) / 100 : null;
  const facts = [`«${f.quote}» (${where(f)}).`];
  if (amount === null) return insufficient("Размер обеспечения заявки найден, но в рублях его не вывести (нет начальной цены).", "начальная цена закупки");
  facts.push(`Замораживается около ${rubles(amount)} до конца процедуры.`);
  if (!i.econ.ready) return insufficient(`Заморозится около ${rubles(amount)}; сравнить с прибылью нельзя.`, "ваши затраты на исполнение (блок «Какую цену ставить»)");
  const profit = i.econ.scenarios.base.profit;
  facts.push(`Ожидаемая прибыль в базовом сценарии: ${rubles(profit)}.`);
  return checked(amount > profit ? "attention" : "ok", amount > profit ? `Обеспечение заявки (${rubles(amount)}) больше ожидаемой прибыли.` : `Обеспечение заявки ${rubles(amount)} — меньше ожидаемой прибыли.`, facts);
}

function performanceSecurity(i: MatrixInput): CheckResult {
  const list = i.risks.filter((r) => r.kind === "security");
  if (!i.hasContract) return insufficient("Проект договора не найден.", "проект договора");
  if (list.length === 0) return insufficient("Обеспечение исполнения в договоре с цифрами не найдено.", "размер обеспечения исполнения (договор или извещение)");
  const facts = list.map((r) => `${r.title} (${r.clause ? `п. ${r.clause}, ` : ""}${r.doc}).`);
  const guarantee = i.estimate.items.find((x) => x.id === "guarantee" && x.amount !== null);
  if (guarantee) facts.push(`Банковская гарантия — около ${rubles(guarantee.amount!)} (по допущению расчёта).`);
  const high = list.find((r) => r.level === "warn");
  return checked(high ? "attention" : "ok", high ? `Высокое обеспечение: ${high.title}.` : list[0].title + ".", facts);
}

const advanceExists = (risks: ContractRisk[]) => risks.some((r) => r.kind === "advance" && !/нет/i.test(r.title));

function payment(i: MatrixInput): CheckResult {
  if (!i.hasContract) return insufficient("Проект договора не найден.", "проект договора");
  const pay = i.risks.find((r) => r.kind === "payment");
  const adv = i.risks.filter((r) => r.kind === "advance");
  if (!pay && adv.length === 0) return insufficient("Срок оплаты и аванс в договоре с цифрами не найдены.", "срок оплаты и аванс (раздел об оплате)");
  const facts = [...(pay ? [`${pay.title} (${pay.clause ? `п. ${pay.clause}, ` : ""}${pay.doc}).`] : []), ...adv.map((a) => `${a.title}.`)];
  const long = pay?.level === "warn";
  return checked(long ? "attention" : "ok", long ? `Оплата долгая: ${pay!.title}.` : pay ? pay.title + "." : adv[0].title + ".", facts);
}

function penalties(i: MatrixInput): CheckResult {
  if (!i.hasContract) return insufficient("Проект договора не найден.", "проект договора");
  const mine = i.risks.filter((r) => r.kind === "penalty" && r.party === "you");
  const theirs = i.risks.filter((r) => r.kind === "penalty" && r.party === "customer");
  if (mine.length === 0 && theirs.length === 0) return insufficient("Неустойка с цифрами в договоре не найдена: это не значит, что её нет.", "раздел об ответственности сторон");
  const facts = [...mine.map((r) => `Платите вы: ${r.title} (${r.clause ? `п. ${r.clause}, ` : ""}${r.doc}).`), ...theirs.map((r) => `Платит заказчик: ${r.title}.`)];
  if (i.estimate.total > 0 && i.estimate.totalPct !== null) facts.push(`Если сработают все оценённые риски — до ${rubles(i.estimate.total)} (${percent(i.estimate.totalPct)} цены).`);
  const heavy = mine.find((r) => r.heavy);
  if (heavy) return checked("risk", `Крупная неустойка на вас: ${heavy.title}.`, facts);
  const attention = mine.find((r) => r.level === "warn");
  if (attention) return checked("attention", `Неустойка на вас: ${attention.title}.`, facts);
  return checked("ok", mine.length > 0 ? `Неустойка умеренная: ${mine[0].title}.` : "На вас неустойка в договоре не найдена; заказчик платит свою.", facts);
}

function workingCapital(i: MatrixInput): CheckResult {
  const pay = i.risks.find((r) => r.kind === "payment" && r.n?.days);
  if (!i.hasContract || !pay) return insufficient("Срок оплаты заказчиком в договоре не найден.", "срок оплаты (проект договора)");
  if (!i.econ.ready) return insufficient(`Оплата через ${pay.n!.days} дн.; сколько своих денег нужно, не посчитать.`, "ваши затраты на исполнение (блок «Какую цену ставить»)");
  const costs = i.econ.scenarios.base.lines.filter((l) => l.group === "costs").reduce((s, l) => s + l.amount, 0);
  const finance = i.estimate.items.find((x) => x.id === "finance" && x.amount !== null);
  const advance = advanceExists(i.risks);
  const facts = [`До оплаты вы вкладываете свои деньги: около ${rubles(costs)} затрат на срок ${pay.n!.days} дн.${advance ? " Аванс есть — часть закрывается им." : " Аванса нет."}`];
  if (finance) facts.push(`Проценты за эти деньги — около ${rubles(finance.amount!)} (ставка по допущению расчёта).`);
  const long = pay.n!.days! >= RISK_RULES.longPaymentDays && !advance;
  return checked(long ? "attention" : "ok", long ? `Свои деньги (≈ ${rubles(costs)}) нужны на ${pay.n!.days} дн., аванса нет.` : `Нагрузка на оборотный капитал умеренная: оплата через ${pay.n!.days} дн.`, facts);
}

function profitability(i: MatrixInput): CheckResult {
  const e = i.econ;
  if (!e.ready) return insufficient(e.reason === "nmck" ? "Начальная цена не найдена." : "Не введены ваши затраты — прибыль не посчитать.", e.reason === "nmck" ? "начальная цена закупки" : "ваши затраты на исполнение (блок «Какую цену ставить»)");
  const base = e.scenarios.base;
  const stress = e.scenarios.stress;
  const facts = [`Базовый сценарий: прибыль ${rubles(base.profit)} (${percent(base.margin)}).`, `Стрессовый: ${rubles(stress.profit)} (${percent(stress.margin)}).`];
  if (e.target === null) facts.push("Целевая маржа недостижима даже по начальной цене.");
  if (base.profit < 0) return checked("risk", `Убыток в базовом сценарии: ${rubles(base.profit)}.`, facts);
  if (stress.profit < 0) return checked("attention", `В стрессовом сценарии убыток: ${rubles(stress.profit)}.`, facts);
  return checked(e.target === null ? "attention" : "ok", e.target === null ? "Прибыль есть, но целевая маржа недостижима." : `Прибыль в базовом (${percent(base.margin)}) и стрессовом сценариях.`, facts);
}

// ——— Квалификация: требования заказчика против базы доказательств ———

const SRO = /(?<![а-яё])СРО(?![а-яё])|саморегулируем|свидетельств[а-яё]*\s+о\s+допуск|допуск[а-яё]*\s+к\s+(?:определ|вид|работ)|членств/i;

const levelOfEvidence = (c: Check): Level => {
  const base: Level = c.status === "ok" ? "ok" : c.status === "expiring" || c.status === "need_human" ? "attention" : "risk";
  // За это дают только баллы или просят «по желанию»: без доказательства заявку не отклонят.
  return base === "risk" && (c.need.optional || c.need.scoring) ? "attention" : base;
};

function qualification(i: MatrixInput, kinds: string[], pick?: (c: Check) => boolean, none = "Такого требования в документах не найдено."): CheckResult {
  if (i.evidence === null) return insufficient("Требования заказчика ещё не сверены с базой доказательств.", "выписанные требования заказчика и ваша база доказательств");
  if (i.evidence.length === 0) return insufficient("Требования заказчика не выписаны.", "анализ документов закупки (шаг «Анализ»)");
  const checks = i.evidence.flatMap((p) => p.checks).filter((c) => kinds.includes(c.need.kind) && (pick ? pick(c) : true));
  if (checks.length === 0) return checked("ok", none, [`Требований заказчика выписано: ${i.evidence.length}; этого вида среди них нет.`]);
  const levels = checks.map(levelOfEvidence);
  const facts = checks.slice(0, 5).map((c) => `${c.need.label}: ${EVIDENCE_TEXT[c.status]}${c.reasons[0] ? ` — ${clip(c.reasons[0], 140)}` : ""}.`);
  if (checks.length > 5) facts.push(`…и ещё ${checks.length - 5}.`);
  const level = worstOf(levels);
  const ok = levels.filter((l) => l === "ok").length;
  return checked(level, level === "ok" ? `Подтверждено: ${ok} из ${checks.length}.` : `Подтверждено ${ok} из ${checks.length}; проверьте остальное.`, facts);
}

const TERMINATION = /односторонн[а-яё]+\s+(?:порядк[а-яё]+\s+)?(?:отказ|расторжени)|отказ[а-яё]*\s+от\s+(?:исполнени[а-яё]+\s+)?(?:контракт|договор)[а-яё]*\s+в\s+односторонн|в\s+односторонн[а-яё]+\s+порядк[а-яё]+\s+(?:отказ|расторг)/i;
const ACCEPTANCE = /(?:приёмк|приемк)[а-яё]*[^.]{0,80}(?:в\s+течение|не\s+более|в\s+срок)\s+\d+|экспертиз[а-яё]*[^.]{0,80}(?:за\s+счёт|за\s+счет|оплачива)/i;

function termination(i: MatrixInput): CheckResult {
  if (!i.hasContract) return insufficient("Проект договора не найден.", "проект договора");
  const contractDocs = i.docs.filter(looksLikeContract);
  const unilateral = findSentences(contractDocs, TERMINATION, 2);
  const acceptance = findSentences(contractDocs, ACCEPTANCE, 2);
  const expertise = i.risks.filter((r) => r.kind === "cost" && /экспертиз/i.test(r.title));
  const facts = [
    ...unilateral.map((f) => `Односторонний отказ: «${f.quote}» (${where(f)}).`),
    ...acceptance.map((f) => `Приёмка: «${f.quote}» (${where(f)}).`),
    ...expertise.map((r) => `${r.title} (${r.clause ? `п. ${r.clause}, ` : ""}${r.doc}).`),
  ];
  if (facts.length === 0) return checked("ok", "В тексте проекта договора таких условий не найдено (поиск по тексту, не юридическая оценка).", []);
  const heavy = i.risks.some((r) => r.kind === "penalty" && r.party === "you" && r.heavy);
  if (heavy && unilateral.length > 0) return checked("risk", "Есть условие об одностороннем отказе заказчика и крупная неустойка на вас.", facts);
  return checked("attention", unilateral.length > 0 ? "В договоре есть условие об одностороннем отказе заказчика." : "Есть условия приёмки или экспертизы, которые стоит учесть.", facts);
}

const ROUTES: Record<number, (i: MatrixInput) => CheckResult> = {
  6: procedure,
  7: marketPrice,
  8: bidSecurity,
  9: performanceSecurity,
  10: payment,
  11: penalties,
  12: workingCapital,
  13: profitability,
  14: (i) => qualification(i, ["experience"]),
  15: (i) => qualification(i, ["license"], (c) => !SRO.test(`${c.need.label} ${c.need.requirement.text}`)),
  16: (i) => qualification(i, ["license"], (c) => SRO.test(`${c.need.label} ${c.need.requirement.text}`)),
  17: (i) => qualification(i, ["finance"]),
  18: (i) => qualification(i, ["employee", "qualification", "equipment"]),
  19: (i) => qualification(i, ["certificate"]),
  26: termination,
};

const clampWeight = (n: unknown, fallback: 1 | 2 | 3): 1 | 2 | 3 => (n === 1 || n === 2 || n === 3 ? n : fallback);

/** Все 27 проверок. Что программа не считает — «не проверено» с указанием источника; то, что участник записал сам, подставляется только вместо непроверенного и недостаточного, посчитанное программой не перекрывается. */
export function buildMatrix(input: MatrixInput): CheckRow[] {
  return CHECKS.map((def) => {
    const route = ROUTES[def.n];
    let result: CheckResult = route
      ? route(input)
      : { state: "not_checked", summary: `${EXTERNAL}${def.source.replace(/\.$/, "")}.`, missing: [def.source.replace(/\.$/, "")] };
    const mine = input.manual?.[def.n];
    if (mine && mine.note.trim() && result.state !== "checked") result = { state: "manual", level: mine.level, summary: mine.note.trim(), source: mine.source.trim() };
    return { def, result, weight: clampWeight(input.weights?.[def.n], def.weight) };
  });
}

export type GroupSummary = { id: GroupId; title: string; total: number; done: number; ok: number; attention: number; risk: number };

export type MatrixSummary = {
  total: number;
  /** Посчитано программой. */
  program: number;
  /** Записано вами. */
  manual: number;
  /** Нужны данные для посчитанных программой проверок. */
  insufficient: number;
  /** Внешние данные, которых в программе нет, и вы их не записали. */
  notChecked: number;
  /** Доля проверенных (программой и вами) из 27, %. */
  coveragePct: number;
  ok: number;
  attention: number;
  risk: number;
  /** Риски и внимание по темам: проверки с одной темой считаются один раз. */
  uniqueAttention: number;
  uniqueRisk: number;
  groups: GroupSummary[];
  /** Что смотреть первым: риск и внимание, от самой важной проверки. */
  first: CheckRow[];
};

const levelOf = (r: CheckResult): Level | null => (r.state === "checked" || r.state === "manual" ? r.level : null);

export function summarize(rows: CheckRow[]): MatrixSummary {
  const done = rows.filter((r) => levelOf(r.result) !== null);
  const by = (level: Level) => done.filter((r) => levelOf(r.result) === level);
  // Тема считается по худшему уровню среди её проверок: риск перекрывает внимание, одна тема — один раз.
  const topicLevel = new Map<string, Level>();
  for (const r of done) {
    const l = levelOf(r.result)!;
    const prev = topicLevel.get(r.def.topic);
    if (!prev || WORST[l] > WORST[prev]) topicLevel.set(r.def.topic, l);
  }
  const topics = [...topicLevel.values()];
  return {
    total: rows.length,
    program: rows.filter((r) => r.result.state === "checked").length,
    manual: rows.filter((r) => r.result.state === "manual").length,
    insufficient: rows.filter((r) => r.result.state === "insufficient").length,
    notChecked: rows.filter((r) => r.result.state === "not_checked").length,
    coveragePct: rows.length === 0 ? 0 : (done.length / rows.length) * 100,
    ok: by("ok").length,
    attention: by("attention").length,
    risk: by("risk").length,
    uniqueAttention: topics.filter((l) => l === "attention").length,
    uniqueRisk: topics.filter((l) => l === "risk").length,
    groups: GROUPS.map((g) => {
      const list = rows.filter((r) => r.def.group === g.id);
      const ok = list.filter((r) => levelOf(r.result) === "ok").length;
      const attention = list.filter((r) => levelOf(r.result) === "attention").length;
      const risk = list.filter((r) => levelOf(r.result) === "risk").length;
      return { id: g.id, title: g.title, total: list.length, done: ok + attention + risk, ok, attention, risk };
    }),
    first: done
      .filter((r) => levelOf(r.result) !== "ok")
      .sort((a, b) => WORST[levelOf(b.result)!] - WORST[levelOf(a.result)!] || b.weight - a.weight || a.def.n - b.def.n),
  };
}

/** Сохранённое в хранилище: записанные вами результаты и веса — только понятное. */
export function normalizeMatrix(raw: unknown): { weights?: Record<string, number>; manual?: Record<string, ManualResult> } {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as { weights?: unknown; manual?: unknown };
  const known = new Set(CHECKS.map((c) => String(c.n)));
  const weights: Record<string, number> = {};
  if (input.weights && typeof input.weights === "object") {
    for (const [k, v] of Object.entries(input.weights as Record<string, unknown>)) if (known.has(k) && (v === 1 || v === 2 || v === 3)) weights[k] = v;
  }
  const manual: Record<string, ManualResult> = {};
  if (input.manual && typeof input.manual === "object") {
    for (const [k, v] of Object.entries(input.manual as Record<string, unknown>)) {
      if (!known.has(k) || !v || typeof v !== "object") continue;
      const m = v as Record<string, unknown>;
      const level = m.level === "ok" || m.level === "attention" || m.level === "risk" ? m.level : null;
      const note = typeof m.note === "string" ? m.note.trim().slice(0, 500) : "";
      if (level && note) manual[k] = { level, note, source: typeof m.source === "string" ? m.source.trim().slice(0, 200) : "" };
    }
  }
  return { ...(Object.keys(weights).length > 0 && { weights }), ...(Object.keys(manual).length > 0 && { manual }) };
}
