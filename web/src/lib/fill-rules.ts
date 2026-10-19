// Правила заполнения заявки, которые заказчик пишет в документации или в «Инструкции по заполнению заявки»:
// «не должно сопровождаться словом «эквивалент»», «не должны содержать слов «не менее», «не более», «или»», «множественность значений не допускается».
// Читает правила из текста документов закупки и сверяет с ними то, что участник предлагает в ТП. Без ИИ: слова ищет код.

type Doc = { name: string; text: string };

export type FillRuleId = "no_equivalent" | "concrete_values";

export type FillRule = {
  id: FillRuleId;
  doc: string;
  // Фраза заказчика, на которой правило основано.
  quote: string;
  // Для concrete_values: какие слова запрещены кроме «не менее»/«не более» — «или»/«либо» и «от … до».
  forbidOr?: boolean;
  forbidFromTo?: boolean;
};

const QUOTE_MAX = 220;

// «…не должно сопровождаться словом «эквивалент»» (Инструкция по заполнению заявки) и «…без указания слов «или эквивалент»» (инструкция под Формой № 1).
const EQUIVALENT_BAN = /не\s+должн[а-яё]*\s+сопровождаться\s+слов[а-яё]*\s+«?\s*(?:эквивалент|аналог)[^.]*|без\s+указани[а-яё]*\s+слов[а-яё]*\s+[«"]?\s*(?:или\s+)?(?:эквивалент|аналог)[^.]*/i;
const BOUND_BAN = /не\s+должн[а-яё]*\s+содержать\s+слов[а-яё]*\s+«?\s*не\s+менее[^.]*/i;
const UNCERTAINTY_BAN = /не\s+допускается\s+наличи[а-яё]*\s+неопределенност[а-яё]*\s+в\s+значени[^.]*/i;
const OR_BAN = /не\s+должн[а-яё]*\s+содержать\s+слов[а-яё]*[^.]{0,160}«\s*или\s*»|включающего\s+союз\s+«\s*или\s*»[^.]*/i;
const FROM_TO_BAN = /не\s+должн[а-яё]*\s+содержать\s+слов[а-яё]*[^.]{0,120}«\s*от\s*»/i;

const around = (text: string, match: RegExpExecArray) => text.slice(match.index, match.index + Math.min(match[0].length, QUOTE_MAX)).replace(/\s+/g, " ").trim();

export function fillRulesOf(documents: Doc[]): FillRule[] {
  const rules: FillRule[] = [];
  for (const doc of documents) {
    const equivalent = EQUIVALENT_BAN.exec(doc.text);
    if (equivalent && !rules.some((r) => r.id === "no_equivalent")) {
      rules.push({ id: "no_equivalent", doc: doc.name, quote: around(doc.text, equivalent) });
    }
    if (rules.some((r) => r.id === "concrete_values")) continue;
    const bound = BOUND_BAN.exec(doc.text) ?? UNCERTAINTY_BAN.exec(doc.text);
    if (bound) {
      rules.push({
        id: "concrete_values",
        doc: doc.name,
        quote: around(doc.text, bound),
        forbidOr: OR_BAN.test(doc.text),
        forbidFromTo: FROM_TO_BAN.test(doc.text),
      });
    }
  }
  // «или» запрещён и тогда, когда о нём сказано в другом документе набора, чем «не менее» (в Инструкции — отдельное предложение про союз).
  const concrete = rules.find((r) => r.id === "concrete_values");
  if (concrete && !concrete.forbidOr && documents.some((d) => OR_BAN.test(d.text))) concrete.forbidOr = true;
  if (concrete && !concrete.forbidFromTo && documents.some((d) => FROM_TO_BAN.test(d.text))) concrete.forbidFromTo = true;
  return rules;
}

// Что предлагает участник: имя места в заявке и текст. Жёлтые пропуски «[число, не меньше 150]» — подсказки участнику, а не его значения.
export type OfferedValue = { where: string; text: string; kind: "good" | "item" };

export type FillViolation = { rule: FillRule; where: string; found: string[]; kind: "good" | "item" };

const stripHoles = (text: string) => text.replace(/\[[^\]]*\]/g, " ");

const EQUIVALENT = /(?<![а-яё])(?:эквивалент|аналог)[а-яё]*/gi;
const BOUND = /(?<![а-яё])не\s+(?:менее|более|ниже|выше|хуже|меньше|больше|превышает)(?![а-яё])/gi;
const OR = /(?<![а-яё])(?:или|либо)(?![а-яё])/gi;
const FROM_TO = /(?<![а-яё])от\s+[\d(+\-−.,][^.;\n]{0,25}?(?<![а-яё])до\s+[\d(+\-−.,]/gi;

const uniq = (list: string[]) => [...new Set(list.map((s) => s.toLowerCase().replace(/\s+/g, " ").trim()))];

export function checkFillRules(rules: FillRule[], values: OfferedValue[]): FillViolation[] {
  const violations: FillViolation[] = [];
  for (const value of values) {
    const text = stripHoles(value.text);
    for (const rule of rules) {
      const found: string[] = [];
      if (rule.id === "no_equivalent") {
        found.push(...(text.match(EQUIVALENT) ?? []));
      } else {
        found.push(...(text.match(BOUND) ?? []));
        // «или» и «от … до» — только в строках показателей товара: в рассказе об услугах («с 9 до 18», «или иное») они обычны.
        if (value.kind === "good") {
          if (rule.forbidOr) found.push(...(text.match(OR) ?? []));
          if (rule.forbidFromTo) found.push(...(text.match(FROM_TO) ?? []));
        }
      }
      if (found.length > 0) violations.push({ rule, where: value.where, found: uniq(found), kind: value.kind });
    }
  }
  return violations;
}
