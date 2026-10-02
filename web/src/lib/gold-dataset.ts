// Золотой датасет обезличенных закупок и функции оценки качества ИИ.
// Все функции — чистые, без LLM. Тесты — npm test.

// ─── Типы эталона ──────────────────────────────────────────────────────────────

export type GoldRequirementKind = "mandatory" | "conditional" | "bonus" | "optional";

/** Эталонное требование заказчика — что система должна найти в тексте документов. */
export type GoldRequirement = {
  kind: GoldRequirementKind;
  text: string;          // описание требования
  article: string;       // правовое основание
  quote: string;         // дословная цитата из документа закупки
  mustFind: boolean;     // true → система обязана извлечь это требование
};

/** Эталонный документ для подачи. */
export type GoldDocument = {
  text: string;
  basis: string;
  mandatory: boolean;
};

/** Эталонное значение поля. */
export type GoldField = {
  key: string;
  value: string;
};

/** Эталонная находка валидации при пустом профиле (нет фактов, нет доказательств). */
export type GoldFinding = {
  category: string;     // тип из ValidationType
  status: "FAIL" | "PASS" | "NEEDS_HUMAN_REVIEW";
};

/** Фрагмент документа закупки. */
export type DocumentExcerpt = {
  source: string;       // «Извещение», «Требования к участникам», «ТЗ», …
  page?: number;
  text: string;
};

/** Один кейс золотого датасета. */
export type GoldCase = {
  id: string;
  name: string;
  law: "44-ФЗ" | "223-ФЗ";
  method: "auction" | "tender" | "quotation" | "proposals";
  nmck: number;
  deadline?: string;
  excerpts: DocumentExcerpt[];
  goldRequirements: GoldRequirement[];
  goldDocuments: GoldDocument[];
  goldFields: GoldField[];
  goldFindings: GoldFinding[];
};

// ─── Типы для вывода модели ────────────────────────────────────────────────────

/** Требование, извлечённое моделью. */
export type ExtractedRequirement = {
  kind: string;
  text: string;
  quote: string;
};

/** Поле, извлечённое моделью. */
export type ExtractedField = {
  key: string;
  value: string;
};

/** Находка валидации, выданная движком. */
export type ComputedFinding = {
  category: string;
  status: string;
};

/** Полный вывод модели для одного кейса. */
export type ModelOutput = {
  caseId: string;
  requirements: ExtractedRequirement[];
  fields: ExtractedField[];
  findings: ComputedFinding[];
};

// ─── Типы метрик ──────────────────────────────────────────────────────────────

export type RequirementMetrics = {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  hallucinationRate: number; // fp / extracted.length
};

export type QuoteMetrics = {
  total: number;
  found: number;
  missing: number;
  accuracy: number;
};

export type FieldMetrics = {
  total: number;
  correct: number;
  accuracy: number;
};

export type ValidationMetrics = {
  total: number;
  correct: number;
  accuracy: number;
};

export type CaseMetrics = {
  caseId: string;
  requirements: RequirementMetrics;
  quotes: QuoteMetrics;
  fields: FieldMetrics;
  validation: ValidationMetrics;
};

export type EvalReport = {
  cases: CaseMetrics[];
  aggregate: {
    requirementF1: number;
    hallucinationRate: number;
    quoteAccuracy: number;
    fieldAccuracy: number;
    validationAccuracy: number;
  };
};

// ─── Вспомогательные функции ──────────────────────────────────────────────────

/** Нижний регистр, без знаков препинания, схлопнутые пробелы. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[«»„""''‐‑‒–—….,;:!?()[\]{}\-\/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Значимые слова (длина > 3). */
function wordSet(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter((w) => w.length > 3));
}

/** Совпадение текстов: Jaccard ≥ 0,25 ИЛИ не менее 3 общих слов. */
function textMatch(a: string, b: string): boolean {
  const sa = wordSet(a);
  const sb = wordSet(b);
  if (sa.size === 0 || sb.size === 0) return false;
  let common = 0;
  for (const w of sa) if (sb.has(w)) common++;
  const j = common / (sa.size + sb.size - common);
  return j >= 0.25 || common >= 3;
}

// ─── Функции оценки ───────────────────────────────────────────────────────────

/**
 * Оценивает качество извлечения требований.
 * TP — mustFind-требования из эталона, найденные моделью.
 * FP — извлечённые требования без пары в mustFind.
 * FN — mustFind-требования, не найденные моделью.
 */
export function evalRequirements(
  extracted: ExtractedRequirement[],
  gold: GoldRequirement[],
): RequirementMetrics {
  const mustFind = gold.filter((g) => g.mustFind);
  const matchedExtracted = new Set<number>();

  let tp = 0;
  for (const g of mustFind) {
    for (let i = 0; i < extracted.length; i++) {
      if (!matchedExtracted.has(i) && textMatch(extracted[i]!.text, g.text)) {
        matchedExtracted.add(i);
        tp++;
        break;
      }
    }
  }

  const fn = mustFind.length - tp;
  const fp = extracted.length - matchedExtracted.size;
  const precision = extracted.length === 0 ? 1 : tp / extracted.length;
  const recall = mustFind.length === 0 ? 1 : tp / mustFind.length;
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const hallucinationRate = extracted.length === 0 ? 0 : fp / extracted.length;

  return { tp, fp, fn, precision, recall, f1, hallucinationRate };
}

/**
 * Оценивает точность цитат: каждая цитата нормализуется и ищется в исходных текстах.
 * Цитата считается верной если найдена как подстрока хотя бы одного фрагмента.
 */
export function evalQuotes(
  items: Array<{ quote: string }>,
  excerpts: DocumentExcerpt[],
): QuoteMetrics {
  const allNorm = excerpts.map((e) => normalize(e.text)).join(" ");
  const withQuote = items.filter((i) => i.quote && i.quote.trim().length > 5);
  let found = 0;
  for (const item of withQuote) {
    if (allNorm.includes(normalize(item.quote))) found++;
  }
  const total = withQuote.length;
  return {
    total,
    found,
    missing: total - found,
    accuracy: total === 0 ? 1 : found / total,
  };
}

/** Оценивает точность извлечённых полей (nmck, deadline и т.п.). */
export function evalFields(
  extracted: ExtractedField[],
  gold: GoldField[],
): FieldMetrics {
  let correct = 0;
  for (const g of gold) {
    const e = extracted.find((f) => f.key === g.key);
    if (e && normalize(e.value) === normalize(g.value)) correct++;
  }
  return {
    total: gold.length,
    correct,
    accuracy: gold.length === 0 ? 1 : correct / gold.length,
  };
}

/** Оценивает точность находок валидации (категория + статус). */
export function evalValidation(
  computed: ComputedFinding[],
  gold: GoldFinding[],
): ValidationMetrics {
  let correct = 0;
  for (const g of gold) {
    if (computed.some((c) => c.category === g.category && c.status === g.status)) {
      correct++;
    }
  }
  return {
    total: gold.length,
    correct,
    accuracy: gold.length === 0 ? 1 : correct / gold.length,
  };
}

/** Вычисляет метрики по одному кейсу. */
export function evalCase(output: ModelOutput, goldCase: GoldCase): CaseMetrics {
  return {
    caseId: output.caseId,
    requirements: evalRequirements(output.requirements, goldCase.goldRequirements),
    quotes: evalQuotes(output.requirements, goldCase.excerpts),
    fields: evalFields(output.fields, goldCase.goldFields),
    validation: evalValidation(output.findings, goldCase.goldFindings),
  };
}

/** Агрегирует метрики по всему датасету. */
export function evalDataset(
  outputs: ModelOutput[],
  cases: GoldCase[],
): EvalReport {
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const caseMetrics: CaseMetrics[] = [];

  for (const output of outputs) {
    const gold = caseMap.get(output.caseId);
    if (!gold) continue;
    caseMetrics.push(evalCase(output, gold));
  }

  const avg = (vals: number[]) =>
    vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;

  return {
    cases: caseMetrics,
    aggregate: {
      requirementF1: avg(caseMetrics.map((c) => c.requirements.f1)),
      hallucinationRate: avg(caseMetrics.map((c) => c.requirements.hallucinationRate)),
      quoteAccuracy: avg(caseMetrics.map((c) => c.quotes.accuracy)),
      fieldAccuracy: avg(caseMetrics.map((c) => c.fields.accuracy)),
      validationAccuracy: avg(caseMetrics.map((c) => c.validation.accuracy)),
    },
  };
}

// ─── Золотые кейсы ────────────────────────────────────────────────────────────
//
// 3 обезличенных тендера с эталонной разметкой.
// Названия заказчиков — выдуманные, суммы изменены.

/**
 * Кейс 1: Электронный аукцион 44-ФЗ, техническое обслуживание оргтехники.
 * НМЦК 1 800 000 руб. Дополнительные требования: опыт не менее 2 контрактов.
 */
export const CASE_AUCTION_IT: GoldCase = {
  id: "ea-001",
  name: "Электронный аукцион 44-ФЗ — техническое обслуживание оргтехники",
  law: "44-ФЗ",
  method: "auction",
  nmck: 1_800_000,
  deadline: "2026-03-15",
  excerpts: [
    {
      source: "Извещение о закупке",
      page: 1,
      text:
        "Наименование объекта закупки: техническое обслуживание и ремонт оргтехники. " +
        "Начальная (максимальная) цена контракта: 1 800 000 (один миллион восемьсот тысяч) рублей. " +
        "Обеспечение заявки: 9 000 рублей (0,5% от НМЦК). " +
        "Дата и время окончания срока подачи заявок: 15 марта 2026 года, 10:00 по московскому времени.",
    },
    {
      source: "Требования к участникам закупки",
      page: 3,
      text:
        "Участник закупки должен соответствовать единым требованиям, установленным частью 1 статьи 31 " +
        "Федерального закона № 44-ФЗ. " +
        "В соответствии с частью 2 статьи 31 и постановлением Правительства РФ № 99 установлены " +
        "дополнительные требования к участникам: наличие не менее двух исполненных контрактов (договоров) " +
        "на выполнение аналогичных работ за последние три года до даты подачи заявки. " +
        "Совокупная стоимость таких контрактов должна составлять не менее 20 процентов " +
        "начальной (максимальной) цены контракта на право заключения которого проводится аукцион.",
    },
    {
      source: "Техническое задание",
      page: 5,
      text:
        "Предмет договора: оказание услуг по техническому обслуживанию и ремонту копировально-множительной " +
        "техники, принтеров и многофункциональных устройств. " +
        "Срок оказания услуг: 12 месяцев с даты заключения контракта. " +
        "Место оказания услуг: г. Краснодар, ул. Ленина, д. 10.",
    },
  ],
  goldRequirements: [
    {
      kind: "mandatory",
      text: "Соответствие единым требованиям ч. 1 ст. 31 44-ФЗ",
      article: "ст. 31 ч. 1 44-ФЗ",
      quote:
        "Участник закупки должен соответствовать единым требованиям, установленным частью 1 статьи 31 " +
        "Федерального закона № 44-ФЗ.",
      mustFind: true,
    },
    {
      kind: "mandatory",
      text: "Опыт: не менее двух исполненных контрактов на аналогичные работы за последние три года",
      article: "ст. 31 ч. 2 44-ФЗ, ПП РФ № 99",
      quote:
        "наличие не менее двух исполненных контрактов (договоров) " +
        "на выполнение аналогичных работ за последние три года до даты подачи заявки.",
      mustFind: true,
    },
    {
      kind: "mandatory",
      text: "Совокупная стоимость контрактов опыта — не менее 20% НМЦК",
      article: "ст. 31 ч. 2 44-ФЗ, ПП РФ № 99",
      quote:
        "Совокупная стоимость таких контрактов должна составлять не менее 20 процентов " +
        "начальной (максимальной) цены контракта",
      mustFind: true,
    },
  ],
  goldDocuments: [
    {
      text: "Декларация соответствия требованиям ч. 1 ст. 31 44-ФЗ",
      basis: "ст. 43 ч. 6 44-ФЗ",
      mandatory: true,
    },
    {
      text: "Копии исполненных контрактов и актов выполненных работ (не менее 2 за 3 года)",
      basis: "ПП РФ № 99, ст. 31 ч. 2 44-ФЗ",
      mandatory: true,
    },
    {
      text: "Техническое предложение с описанием методологии и ресурсов",
      basis: "документация о закупке",
      mandatory: true,
    },
  ],
  goldFields: [
    { key: "nmck", value: "1800000" },
    { key: "security_deposit", value: "9000" },
    { key: "deadline", value: "2026-03-15" },
  ],
  goldFindings: [
    // При пустом профиле: нет контрактов опыта → FAIL
    { category: "required_documents", status: "FAIL" },
    // Поля заявки не заполнены → NEEDS_HUMAN_REVIEW
    { category: "required_fields", status: "NEEDS_HUMAN_REVIEW" },
  ],
};

/**
 * Кейс 2: Открытый конкурс 44-ФЗ, поставка медицинского оборудования.
 * НМЦК 12 400 000 руб. Дополнительные требования: лицензия, опыт, специалисты.
 */
export const CASE_TENDER_MEDICAL: GoldCase = {
  id: "tender-002",
  name: "Открытый конкурс 44-ФЗ — поставка и монтаж медицинского оборудования",
  law: "44-ФЗ",
  method: "tender",
  nmck: 12_400_000,
  deadline: "2026-04-10",
  excerpts: [
    {
      source: "Извещение о закупке",
      page: 1,
      text:
        "Наименование объекта закупки: поставка, монтаж и ввод в эксплуатацию медицинского " +
        "диагностического оборудования. " +
        "Начальная (максимальная) цена контракта: 12 400 000 (двенадцать миллионов четыреста тысяч) рублей. " +
        "Обеспечение заявки: 248 000 рублей (2% от НМЦК). " +
        "Обеспечение исполнения контракта: 1 240 000 рублей (10% от НМЦК). " +
        "Дата окончания подачи заявок: 10 апреля 2026 года, 09:00.",
    },
    {
      source: "Требования к участникам закупки",
      page: 4,
      text:
        "В соответствии с постановлением Правительства РФ № 99 к участникам закупки " +
        "предъявляются следующие дополнительные требования: " +
        "1) наличие лицензии на осуществление деятельности по техническому обслуживанию " +
        "медицинских изделий (за исключением случая, если данная деятельность осуществляется " +
        "для обеспечения собственных нужд юридического лица); " +
        "2) наличие не менее одного исполненного контракта (договора) на поставку " +
        "аналогичного оборудования за последние три года. " +
        "Стоимость такого контракта (договора) должна составлять не менее 20 процентов НМЦК. " +
        "3) наличие в штате не менее двух специалистов с высшим техническим образованием, " +
        "прошедших обучение у производителя поставляемого оборудования.",
    },
    {
      source: "Критерии оценки заявок",
      page: 7,
      text:
        "Победитель определяется по наибольшей сумме баллов. " +
        "Критерий 1: цена контракта — вес 60%. " +
        "Критерий 2: квалификация участников закупки — вес 40%, в том числе: " +
        "опыт по успешной поставке и монтажу аналогичного оборудования — 30 баллов при наличии " +
        "трёх и более контрактов, 15 баллов — при наличии одного или двух; " +
        "наличие сертификата авторизованного сервисного центра производителя — 10 баллов при наличии / 0 при отсутствии.",
    },
  ],
  goldRequirements: [
    {
      kind: "mandatory",
      text: "Лицензия на техническое обслуживание медицинских изделий",
      article: "ПП РФ № 99, ст. 31 ч. 2 44-ФЗ",
      quote:
        "наличие лицензии на осуществление деятельности по техническому обслуживанию " +
        "медицинских изделий",
      mustFind: true,
    },
    {
      kind: "mandatory",
      text: "Опыт: не менее одного контракта на поставку аналогичного оборудования за 3 года, стоимость ≥ 20% НМЦК",
      article: "ПП РФ № 99, ст. 31 ч. 2 44-ФЗ",
      quote:
        "наличие не менее одного исполненного контракта (договора) на поставку " +
        "аналогичного оборудования за последние три года.",
      mustFind: true,
    },
    {
      kind: "mandatory",
      text: "Специалисты: не менее двух с высшим техническим образованием, обученных у производителя",
      article: "ПП РФ № 99, ст. 31 ч. 2 44-ФЗ",
      quote:
        "наличие в штате не менее двух специалистов с высшим техническим образованием, " +
        "прошедших обучение у производителя поставляемого оборудования.",
      mustFind: true,
    },
    {
      kind: "bonus",
      text: "Баллы: 30 при наличии трёх и более контрактов, 15 — при одном или двух",
      article: "документация о закупке, критерии оценки",
      quote:
        "30 баллов при наличии трёх и более контрактов, 15 баллов — при наличии одного или двух",
      mustFind: true,
    },
    {
      kind: "bonus",
      text: "Баллы: сертификат авторизованного сервисного центра — 10 баллов",
      article: "документация о закупке, критерии оценки",
      quote:
        "наличие сертификата авторизованного сервисного центра производителя — 10 баллов при наличии / 0 при отсутствии.",
      mustFind: true,
    },
  ],
  goldDocuments: [
    {
      text: "Лицензия на техническое обслуживание медицинских изделий",
      basis: "ПП РФ № 99",
      mandatory: true,
    },
    {
      text: "Копии контрактов (договоров) на поставку аналогичного оборудования и актов приёмки",
      basis: "ПП РФ № 99",
      mandatory: true,
    },
    {
      text: "Сведения о специалистах: дипломы и документы об обучении у производителя",
      basis: "ПП РФ № 99",
      mandatory: true,
    },
    {
      text: "Сертификат авторизованного сервисного центра производителя",
      basis: "документация о закупке",
      mandatory: false,
    },
  ],
  goldFields: [
    { key: "nmck", value: "12400000" },
    { key: "security_deposit", value: "248000" },
    { key: "contract_security", value: "1240000" },
    { key: "deadline", value: "2026-04-10" },
  ],
  goldFindings: [
    { category: "required_documents", status: "FAIL" },
    { category: "required_fields", status: "NEEDS_HUMAN_REVIEW" },
  ],
};

/**
 * Кейс 3: Запрос котировок 44-ФЗ, поставка канцелярских товаров.
 * НМЦК 320 000 руб. — обеспечение заявки не требуется (до 1 млн), простые требования.
 */
export const CASE_QUOTATION_SUPPLIES: GoldCase = {
  id: "quotation-003",
  name: "Запрос котировок 44-ФЗ — поставка канцелярских товаров",
  law: "44-ФЗ",
  method: "quotation",
  nmck: 320_000,
  deadline: "2026-02-28",
  excerpts: [
    {
      source: "Извещение о запросе котировок",
      page: 1,
      text:
        "Наименование объекта закупки: поставка канцелярских товаров. " +
        "Начальная (максимальная) цена контракта: 320 000 (триста двадцать тысяч) рублей. " +
        "Обеспечение заявки не установлено — начальная цена контракта не превышает 1 000 000 рублей. " +
        "Дата окончания подачи заявок (котировочных заявок): 28 февраля 2026 года, 17:00.",
    },
    {
      source: "Требования к участникам",
      page: 2,
      text:
        "К участникам закупки предъявляются единые требования в соответствии с частью 1 статьи 31 " +
        "Федерального закона № 44-ФЗ. " +
        "Дополнительные требования к участникам не установлены. " +
        "Участник должен подтвердить соответствие требованиям путём представления декларации, " +
        "составленной в произвольной форме.",
    },
    {
      source: "Техническое задание",
      page: 3,
      text:
        "Наименование и количество товара: бумага офисная А4 500 листов — 200 пачек; " +
        "ручки шариковые синие — 500 штук; папки-скоросшиватели — 100 штук. " +
        "Срок поставки: не позднее 10 рабочих дней с даты заключения контракта. " +
        "Место поставки: г. Нижний Новгород, ул. Советская, д. 5, склад № 2.",
    },
  ],
  goldRequirements: [
    {
      kind: "mandatory",
      text: "Соответствие единым требованиям ч. 1 ст. 31 44-ФЗ (декларация в произвольной форме)",
      article: "ст. 31 ч. 1, ст. 43 ч. 6 44-ФЗ",
      quote:
        "К участникам закупки предъявляются единые требования в соответствии с частью 1 статьи 31 " +
        "Федерального закона № 44-ФЗ.",
      mustFind: true,
    },
    {
      kind: "optional",
      text: "Дополнительных требований нет",
      article: "ст. 31 ч. 2 44-ФЗ",
      quote: "Дополнительные требования к участникам не установлены.",
      mustFind: false,
    },
  ],
  goldDocuments: [
    {
      text: "Котировочная заявка с ценовым предложением",
      basis: "ст. 73 44-ФЗ",
      mandatory: true,
    },
    {
      text: "Декларация соответствия требованиям ч. 1 ст. 31 44-ФЗ",
      basis: "ст. 43 ч. 6 44-ФЗ",
      mandatory: true,
    },
  ],
  goldFields: [
    { key: "nmck", value: "320000" },
    { key: "deadline", value: "2026-02-28" },
  ],
  goldFindings: [
    // Нет обеспечения (НМЦК < 1 млн) → PASS по обеспечению
    { category: "required_fields", status: "NEEDS_HUMAN_REVIEW" },
    // Документы: декларация — стандартная, NEEDS_HUMAN_REVIEW
    { category: "required_documents", status: "NEEDS_HUMAN_REVIEW" },
  ],
};

/** Полный золотой датасет. */
export const GOLD_DATASET: GoldCase[] = [
  CASE_AUCTION_IT,
  CASE_TENDER_MEDICAL,
  CASE_QUOTATION_SUPPLIES,
];
