// Версионируемая база правил законодательства о закупках.
// Каждая редакция правила привязана к диапазону дат.
// Применяется только редакция, действовавшая на дату закупки.

export type LawCode = "44-ФЗ" | "223-ФЗ";

export type RuleKind =
  | "participant_documents"  // перечень документов участника
  | "electronic_submission"  // обязательность электронной формы
  | "security_deposit"       // обеспечение заявки
  | "contract_security"      // обеспечение исполнения контракта
  | "rejection_grounds"      // основания отклонения заявки
  | "qualification_check"    // проверка соответствия требованиям
  | "experience_requirement" // требования к опыту
  | "price_reduction";       // снижение цены, антидемпинг

export type ProcurementMethod =
  | "auction"    // электронный аукцион
  | "tender"     // конкурс (открытый, с ограниченным участием, двухэтапный)
  | "quotation"  // запрос котировок
  | "proposals"  // запрос предложений
  | "sole";      // закупка у единственного поставщика

export type LegalRule = {
  id: string;                    // стабильный ID вида «44-docs-v2»
  version: number;               // номер редакции (1, 2, …)
  law: LawCode;
  article: string;               // «ст. 43 ч. 6 п. 2»
  kind: RuleKind;
  text: string;                  // текст правила для отображения
  effectiveFrom: string;         // ISO-дата начала действия
  effectiveTo: string | null;    // ISO-дата конца; null — действует по сей день
  amendment?: string;            // закон, которым введена эта редакция
  methods?: ProcurementMethod[]; // undefined — применяется ко всем способам
};

// ─── база правил ──────────────────────────────────────────────────────────────

const RULES: LegalRule[] = [
  // ── 44-ФЗ: Перечень документов участника ─────────────────────────────────
  {
    id: "44-docs-v1",
    version: 1,
    law: "44-ФЗ",
    article: "ст. 43 ч. 3",
    kind: "participant_documents",
    text: "Участник подаёт декларацию о соответствии требованиям ч. 1 ст. 31, документы о правоспособности и полномочиях, документы об опыте, квалификации и финансовом положении (если установлены дополнительные требования по ст. 31 ч. 2).",
    effectiveFrom: "2014-01-01",
    effectiveTo: "2021-12-31",
  },
  {
    id: "44-docs-v2",
    version: 2,
    law: "44-ФЗ",
    article: "ст. 43 ч. 6",
    kind: "participant_documents",
    text: "Сведения из ЕГРЮЛ/ЕГРИП и реестра дисквалифицированных лиц запрашиваются оператором площадки автоматически (п. 2 ч. 6 ст. 43). Участник подаёт документы об опыте, квалификации и финансовом положении только если установлены дополнительные требования по ст. 31 ч. 2.",
    effectiveFrom: "2022-01-01",
    effectiveTo: null,
    amendment: "ФЗ-360 от 02.07.2021",
  },

  // ── 44-ФЗ: Электронная форма подачи ──────────────────────────────────────
  {
    id: "44-electronic-v1",
    version: 1,
    law: "44-ФЗ",
    article: "ст. 59",
    kind: "electronic_submission",
    text: "Электронный аукцион обязателен для товаров, работ и услуг из перечня Правительства. Конкурсы, запросы котировок и предложений могут проводиться в бумажной или смешанной форме.",
    effectiveFrom: "2014-01-01",
    effectiveTo: "2021-12-31",
    methods: ["auction"],
  },
  {
    id: "44-electronic-v2",
    version: 2,
    law: "44-ФЗ",
    article: "ст. 24.1",
    kind: "electronic_submission",
    text: "Все конкурентные закупки проводятся исключительно в электронной форме на операторах электронных площадок из перечня Правительства (ст. 24.1 ч. 1).",
    effectiveFrom: "2022-01-01",
    effectiveTo: null,
    amendment: "ФЗ-360 от 02.07.2021",
  },

  // ── 44-ФЗ: Обеспечение заявки ─────────────────────────────────────────────
  {
    id: "44-deposit-v1",
    version: 1,
    law: "44-ФЗ",
    article: "ст. 44",
    kind: "security_deposit",
    text: "Обеспечение заявки устанавливается в размере 0,5–5 % НМЦК при НМЦК свыше 1 млн руб. Вносится денежными средствами или банковской гарантией.",
    effectiveFrom: "2014-01-01",
    effectiveTo: "2021-12-31",
  },
  {
    id: "44-deposit-v2",
    version: 2,
    law: "44-ФЗ",
    article: "ст. 44",
    kind: "security_deposit",
    text: "Обеспечение заявки не требуется при НМЦК до 1 млн руб. (ч. 1 ст. 44). При НМЦК 1–20 млн — 0,5–1 %, свыше 20 млн — 0,5–5 %. Вносится на спецсчёт деньгами или независимой гарантией (вместо банковской).",
    effectiveFrom: "2022-01-01",
    effectiveTo: null,
    amendment: "ФЗ-360 от 02.07.2021",
  },

  // ── 44-ФЗ: Основания отклонения заявки ───────────────────────────────────
  {
    id: "44-rejection-v1",
    version: 1,
    law: "44-ФЗ",
    article: "ст. 67",
    kind: "rejection_grounds",
    text: "Аукционная комиссия отклоняет первую часть заявки при несоответствии требованиям документации или наличии недостоверных сведений. Вторую часть — при несоответствии требованиям ст. 31.",
    effectiveFrom: "2014-01-01",
    effectiveTo: "2021-12-31",
    methods: ["auction"],
  },
  {
    id: "44-rejection-v2",
    version: 2,
    law: "44-ФЗ",
    article: "ст. 43 ч. 12",
    kind: "rejection_grounds",
    text: "Оператор площадки отклоняет заявку за несоответствие единым требованиям ст. 31 ч. 1 (проверяется автоматически) или ненадлежащее обеспечение. Комиссия отклоняет за несоответствие дополнительным требованиям ст. 31 ч. 2 и техническим требованиям документации.",
    effectiveFrom: "2022-01-01",
    effectiveTo: null,
    amendment: "ФЗ-360 от 02.07.2021",
  },

  // ── 44-ФЗ: Антидемпинг ────────────────────────────────────────────────────
  {
    id: "44-antidump-v1",
    version: 1,
    law: "44-ФЗ",
    article: "ст. 37",
    kind: "price_reduction",
    text: "При снижении НМЦК на 25 % и более участник обязан предоставить обеспечение контракта в полуторном размере или подтвердить добросовестность тремя исполненными контрактами за последние три года (один — не менее 20 % НМЦК).",
    effectiveFrom: "2014-01-01",
    effectiveTo: null,
  },

  // ── 223-ФЗ: Электронная форма подачи ─────────────────────────────────────
  {
    id: "223-electronic-v1",
    version: 1,
    law: "223-ФЗ",
    article: "ст. 3.1",
    kind: "electronic_submission",
    text: "Закупки в электронной форме проводятся по усмотрению заказчика в соответствии с положением о закупке.",
    effectiveFrom: "2012-07-18",
    effectiveTo: "2018-06-30",
  },
  {
    id: "223-electronic-v2",
    version: 2,
    law: "223-ФЗ",
    article: "ст. 3.1 ч. 4",
    kind: "electronic_submission",
    text: "Конкурентные закупки среди субъектов МСП проводятся исключительно в электронной форме на площадках из перечня Правительства (ч. 4 ст. 3.1).",
    effectiveFrom: "2018-07-01",
    effectiveTo: null,
    amendment: "ФЗ-505 от 31.12.2017",
  },
];

// ─── функции ──────────────────────────────────────────────────────────────────

/** Проверяет, действовало ли правило на дату закупки. */
export function ruleApplies(
  rule: Pick<LegalRule, "effectiveFrom" | "effectiveTo">,
  procurementDate: string,
): boolean {
  if (procurementDate < rule.effectiveFrom) return false;
  if (rule.effectiveTo !== null && procurementDate > rule.effectiveTo) return false;
  return true;
}

/** Все правила, действовавшие на дату закупки (по закону и/или виду). */
export function rulesAt(
  procurementDate: string,
  law?: LawCode,
  kind?: RuleKind,
): LegalRule[] {
  return RULES.filter((r) => {
    if (law && r.law !== law) return false;
    if (kind && r.kind !== kind) return false;
    return ruleApplies(r, procurementDate);
  });
}

/** Действующая редакция правила по базовому id (например «44-docs») на дату закупки.
 *  Если несколько редакций попали в диапазон (не должно, но страхует) — берётся с наибольшим version. */
export function ruleVersionAt(
  baseId: string,
  procurementDate: string,
): LegalRule | null {
  const prefix = baseId + "-v";
  const matches = RULES.filter(
    (r) => r.id.startsWith(prefix) && ruleApplies(r, procurementDate),
  );
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (a.version >= b.version ? a : b));
}

/** Все правила, действующие сегодня. */
export function currentRules(law?: LawCode, kind?: RuleKind): LegalRule[] {
  return rulesAt(new Date().toISOString().slice(0, 10), law, kind);
}

/** Полная база — все редакции, без фильтра по дате. */
export function allRules(): LegalRule[] {
  return RULES.slice();
}
