import * as z from "zod/v4";
import { allNumbers } from "@/lib/conditions";
import { datesIn, dayOf, FACT_KINDS, FACT_KIND_KEYS, parseRuDate, stemShare, stemsOf, textWords, type FactKind, type Measure, type Validity } from "@/lib/evidence-base";
import { lenient } from "@/lib/lenient";
import { quoteChecker } from "@/lib/quotes";

// Факты о компании из её документов: лицензии, сертификаты, договоры, сотрудники, оборудование, финансы. Ищет ИИ, а проверяет код:
// факт попадает в базу, только если цитата стоит в документе дословно, а номера, даты, сроки и числа — в его тексте. Что не нашлось
// в документе, из ответа убирается: база не должна получить то, чего нет в доказательстве. Найденное всё равно ждёт человека.

export const FoundFactSchema = z.object({
  kind: z.enum(FACT_KIND_KEYS).describe("Вид факта"),
  title: z.string().describe("Коротко, что это: «Лицензия на образовательную деятельность № Л035-00115-77/00123456», «Договор № 45 с Управлением образования», «Иванов Иван Иванович, звукорежиссёр»"),
  fields: lenient(z.array(z.object({ key: z.string(), value: z.string() })), []).describe("Поля факта: key — из списка для этого вида, value — как в документе"),
  measures: lenient(z.array(z.object({ what: z.string(), value: z.number(), unit: z.string() })), []).describe(
    "Числа факта из документа: вместимость, мощность, стаж, цена договора в рублях; пустой список, если чисел нет"
  ),
  validFrom: lenient(z.string(), "").describe("Начало срока действия, ГГГГ-ММ-ДД; пустая строка, если в документе нет"),
  validUntil: lenient(z.string(), "").describe("Конец срока действия, ГГГГ-ММ-ДД, только если он написан в документе; пустая строка, если нет"),
  perpetual: lenient(z.boolean(), false).describe("true — в документе сказано «бессрочно» или «без ограничения срока действия»"),
  source: z.string().describe("Название документа, как в заголовке блока"),
  quote: z.string().describe("Дословный фрагмент этого документа, из которого следует факт, — одна-две фразы"),
});

export const FactsFoundSchema = z.object({ facts: z.array(FoundFactSchema) });

export type FoundFact = z.infer<typeof FoundFactSchema>;

// Факт, прошедший проверку по документу: из него клиент делает запись базы (evidence-base.ts: makeFact).
export type VerifiedFact = {
  kind: FactKind;
  title: string;
  fields: Record<string, string>;
  measures: Measure[];
  validity: Validity;
  source: { type: "document"; docId: string; docName: string; quote: string };
};

export type SentDoc = { id: string; name: string; text: string };

const KIND_LINES = FACT_KIND_KEYS.map((kind) => {
  const meta = FACT_KINDS[kind];
  return `- ${kind} — ${meta.one.toLowerCase()}. Поля: ${meta.fields.map((f) => `${f.key} (${f.label.toLowerCase()}${"date" in f && f.date ? ", ГГГГ-ММ-ДД" : ""})`).join(", ")}.`;
}).join("\n");

export const FACTS_INSTRUCTIONS = `Задание: выпиши факты о компании участника из его документов — то, чем компания может подтвердить своё право участвовать в закупке и получить баллы. Участник — тот, чьи это документы; сведения о заказчиках и других организациях фактами компании не являются.

Виды фактов:
${KIND_LINES}

Правила:
- Каждый факт — из одного места документа. quote — дословный фрагмент этого документа, из которого факт следует; source — название документа, как в заголовке блока. Своими словами и по памяти не пиши.
- Выписывай только то, что есть в документах. Чего в них нет — номера, даты, срока, числа, — не включай и не выдумывай: пустое поле лучше угаданного.
- Даты — ГГГГ-ММ-ДД. validUntil — только если конец срока написан в документе («действительна до 31.12.2026»); validFrom — только если написано начало срока. Дата выдачи или дата документа — не срок действия: она идёт в поле issuedAt. «Бессрочно» — perpetual: true.
- measures — числа факта, которые есть в документе: вместимость площадки в местах, мощность оборудования, стаж в годах, цена договора в рублях (what — «цена договора», unit — «руб»). Единицу пиши, как в документе.
- Один и тот же документ — один факт. Договор и акт к нему — один факт «исполненный договор»: в actNo и actDate номер и дата акта.
- У сотрудника title — ФИО; его диплом, удостоверение, допуск — отдельные факты вида qualification, у них holder — ФИО сотрудника, и срок действия, если он есть.
- Реквизиты компании — ИНН, ОГРН, адрес, счёт, руководитель — не выписывай: они вносятся в профиль отдельно. Не выписывай и документы заказчика — извещение, техническое задание, проект контракта, протоколы закупок.
- Нет ни одного подходящего факта — верни пустой список.`;

// ———— Проверка по документу ————

const NUMBERISH = new Set(["number", "contractNo", "actNo"]);
const compact = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, "");
const sameName = (a: string, b: string) => compact(a) === compact(b);

// Сколько слов названия и полей должно найтись в документе: из двух — оба, из трёх — два.
const SHARE = 0.6;

type Prepared = SentDoc & { has: (quote: string) => boolean; compact: string; dates: Set<string>; numbers: Set<number>; words: string[]; perpetual: boolean };

const prepare = (d: SentDoc): Prepared => ({
  ...d,
  has: quoteChecker([d.text]),
  compact: compact(d.text),
  dates: new Set(datesIn(d.text).map((x) => x.iso)),
  numbers: new Set(allNumbers(d.text)),
  words: textWords(d.text),
  perpetual: /бессрочн|без\s+ограничени[а-яё]*\s+срока/i.test(d.text),
});

// Номер документа есть в тексте. Короткий — «1» из «акт № 1» — сам по себе ничего не доказывает: он принимается только после «№», «акт» или «договор».
function numberInDoc(value: string, doc: Pick<Prepared, "text" | "compact">): boolean {
  const c = compact(value);
  if (c.length >= 3) return doc.compact.includes(c);
  if (c.length === 0) return false;
  // compact() оставляет только буквы и цифры — экранировать в регулярном выражении нечего.
  return new RegExp(`(?:№|(?<![a-zа-я])n|акт[а-яё]*|договор[а-яё]*)\\s*${c}(?![\\dа-яё])`, "i").test(doc.text);
}

// Дата как её вернула модель или вписал человек — в «ГГГГ-ММ-ДД»; не дата — null.
const isoOf = (value: string) => (dayOf(value.trim()) !== null ? value.trim() : parseRuDate(value));

export function verifyFacts(found: FoundFact[], documents: SentDoc[]): { facts: VerifiedFact[]; dropped: number; issues: string[] } {
  const docs = documents.map(prepare);
  const facts: VerifiedFact[] = [];
  const issues: string[] = [];
  let dropped = 0;

  for (const f of found) {
    const title = f.title.trim();
    const quote = f.quote.trim();
    const name = title || "без названия";
    // Документ, названный моделью; не нашли по названию — любой, где есть эта цитата.
    const doc = [...docs.filter((d) => sameName(d.name, f.source)), ...docs].find((d) => quote !== "" && d.has(quote));
    if (!title || !doc) {
      dropped++;
      issues.push(`«${name}»: цитаты нет в документах — не добавлено`);
      continue;
    }
    // Название — из слов документа: цитата настоящая, но модель могла приписать ей другой предмет.
    if (stemShare(stemsOf(title), doc.words) < SHARE) {
      dropped++;
      issues.push(`«${name}»: в документе нет слов из названия — не добавлено`);
      continue;
    }

    const allowed = new Map<string, boolean>(FACT_KINDS[f.kind].fields.map((x) => [x.key, "date" in x && Boolean(x.date)]));
    const fields: Record<string, string> = {};
    for (const { key, value } of f.fields) {
      const text = value.trim();
      if (!text || !allowed.has(key)) continue;
      if (allowed.get(key)) {
        const date = isoOf(text);
        if (date && doc.dates.has(date)) fields[key] = date;
        else issues.push(`«${name}»: дата «${text}» не найдена в документе — поле «${key}» оставлено пустым`);
      } else if (NUMBERISH.has(key)) {
        if (numberInDoc(text, doc)) fields[key] = text;
        else issues.push(`«${name}»: номер «${text}» не найден в документе — поле «${key}» оставлено пустым`);
      } else if (stemShare(stemsOf(text), doc.words) >= SHARE) {
        fields[key] = text;
      } else {
        issues.push(`«${name}»: «${text}» не найдено в документе — поле «${key}» оставлено пустым`);
      }
    }

    const validity: Validity = {};
    for (const [key, value] of [["from", f.validFrom], ["until", f.validUntil]] as const) {
      if (!value.trim()) continue;
      const date = isoOf(value);
      if (date && doc.dates.has(date)) validity[key] = date;
      else issues.push(`«${name}»: дата срока «${value}» не найдена в документе — срок не указан`);
    }
    if (f.perpetual) {
      if (doc.perpetual) validity.perpetual = true;
      else issues.push(`«${name}»: слова «бессрочно» в документе нет — срок не указан`);
    }

    const measures: Measure[] = [];
    for (const m of f.measures) {
      if (m.what.trim() && Number.isFinite(m.value) && doc.numbers.has(m.value)) measures.push({ what: m.what.trim(), value: m.value, unit: m.unit.trim() });
      else issues.push(`«${name}»: число ${m.value} («${m.what}») не найдено в документе — не добавлено`);
    }

    facts.push({ kind: f.kind, title, fields, measures, validity, source: { type: "document", docId: doc.id, docName: doc.name, quote } });
  }
  return { facts, dropped, issues };
}

// Сколько текста документа уходит модели: договоры бывают в десятки страниц, а для факта хватает начала — стороны, предмет, цена —
// и конца — подписи, акт. Лицензии, сертификаты и выписки короткие и идут целиком.
export const FACTS_DOC_LIMIT = 30_000;
export const FACTS_TOTAL_LIMIT = 200_000;
