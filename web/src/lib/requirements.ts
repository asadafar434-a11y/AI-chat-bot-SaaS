import * as z from "zod/v4";
import type { Condition } from "@/lib/conditions";
import { CriteriaSchema, type Criteria } from "@/lib/criteria";
import { lenient } from "@/lib/lenient";

// Требование заказчика — то, что написано в документах закупки. Не предложение поставщика: что поставщик предложит,
// знает только он, и значение за него из границы заказчика («не менее 150») не выводится (conditions.ts, tp-guard.ts).
// У требования: текст, источник и цитата; обязательность; тип; срок; числовые условия; как проверить; чем подтвердить;
// статус. Статус не хранится: он считается из проверки цитаты и из того, что вписал участник (requirement-offers.ts).

// Обязательность, как её называет документ: required — без этого отклонят, не допустят или не заключат контракт;
// optional — по желанию; conditional — только при условии; scored — за это дают баллы; unclear — документ не говорит.
export const MANDATORY = ["required", "optional", "conditional", "scored", "unclear"] as const;
export type Mandatory = (typeof MANDATORY)[number];

// Тип: participant — к участнику; document — документ или сведения в заявке; product — к товару; service — к работам и услугам;
// contract — условие контракта; deadline — срок; money — деньги; scoring — критерий оценки; other — остальное.
export const REQ_TYPES = ["participant", "document", "product", "service", "contract", "deadline", "money", "scoring", "other"] as const;
export type ReqType = (typeof REQ_TYPES)[number];

export const MANDATORY_TEXT: Record<Mandatory, string> = {
  required: "Обязательно",
  optional: "По желанию",
  conditional: "При условии",
  scored: "За баллы",
  unclear: "Не указано",
};

export const TYPE_TEXT: Record<ReqType, string> = {
  participant: "К участнику",
  document: "Документ",
  product: "Товар",
  service: "Работы и услуги",
  contract: "Условие контракта",
  deadline: "Срок",
  money: "Деньги",
  scoring: "Оценка",
  other: "Другое",
};

// Заказчик сам пишет, что без этого заявку не отклонят: документы для оценки, предложение по критериям.
export const NOT_GROUNDS = /не\s+является\s+(причиной|основанием)\s+(для\s+)?(отклонени|признани)/i;

// Числовое условие так, как его выписывает модель; код сверяет его с цитатой и приводит к Condition (requirement-engine.ts).
const NumberSchema = z.object({
  what: z.string().describe("О чём число, как в документе: «вместимость зала», «опыт ведущего», «срок передачи фотографий»"),
  op: z
    .enum(["min", "max", "gt", "lt", "exact", "range"])
    .describe("min — не менее, не ниже, от; max — не более, не выше, до; gt — более, свыше; lt — менее; exact — ровно столько, без границы; range — от … до …"),
  value: z.number().describe("Число из документа; у range — нижняя граница"),
  value2: z.number().describe("Верхняя граница у range; у остальных — 0"),
  unit: z.string().describe("Единица измерения, как в документе: «мест», «лет», «рабочих дней», «кВт», «%», «руб.»; пустая строка, если её нет"),
  raw: z.string().describe("Дословный кусок цитаты с этим условием, например «не менее 150 мест»"),
});

const CoreSchema = z.object({
  text: z.string().describe("Пункт одной строкой простыми словами — с числами, датами и суммами из документа"),
  source: z.string().describe("Где это написано, коротко: «Извещение, раздел 4», «ТЗ, п. 2.1», «Проект контракта, п. 2.5»"),
  quote: z.string().describe("Дословная цитата из документа, на которой основан пункт"),
});

// Новые поля требования модель иногда пропускает или заполняет не из списка: пропущенное принимается как «не указано» (lenient.ts),
// а код всё равно перепроверяет эти поля по цитате.
const ItemSchema = CoreSchema.extend({
  mandatory: lenient(z.enum(MANDATORY), "unclear").describe(
    "Обязательность, как её называет документ: required — без этого отклонят или не допустят; optional — по желанию, отклонения не будет; conditional — только при условии (условие — в text); scored — за это дают баллы; unclear — документ не говорит"
  ),
  type: lenient(z.enum(REQ_TYPES), "other").describe(
    "Тип: participant — к участнику; document — документ или сведения в заявке; product — к товару; service — к работам и услугам; contract — условие контракта; deadline — срок; money — деньги; scoring — критерий оценки; other — остальное"
  ),
  deadline: lenient(z.string(), "").describe(
    "Срок, который относится к этому пункту, словами документа: «до 30.09.2026 10:00 (МСК)», «в течение 5 рабочих дней после мероприятия»; пустая строка, если срока нет"
  ),
  numbers: lenient(z.array(NumberSchema), []).describe("Числовые условия пункта, каждое отдельно; пустой список, если чисел нет"),
  check: lenient(z.string(), "").describe(
    "Как проверить, что предложение участника подходит, одной фразой, если проверка — не только число из numbers: «названа модель товара», «приложена копия лицензии»; иначе пустая строка"
  ),
  evidence: lenient(z.array(z.string()), []).describe(
    "Чем участник подтверждает выполнение, если документ это называет: «копия сертификата соответствия», «акты о приёмке»; иначе пустой список"
  ),
});

export const RequirementsSchema = z.object({
  short: z.string().describe("Короткое название закупки для списка, 2–5 слов, например «Поставка канцтоваров»"),
  subject: z.string().describe("Предмет закупки одной строкой; пустая строка, если не указан"),
  kind: z.string().describe("Закон и способ закупки, например «44-ФЗ · электронный аукцион»; пустая строка, если не указано"),
  customer: z.string().describe("Заказчик, как в документах; пустая строка, если не указан"),
  price: z.string().describe("Начальная (максимальная) цена контракта или договора, например «685 000 ₽»; пустая строка, если не указана"),
  deadline: z.object({
    date: z.string().describe("Дата окончания подачи заявок в формате ГГГГ-ММ-ДД; пустая строка, если её нет в документах"),
    time: z.string().describe("Время окончания подачи заявок в формате ЧЧ:ММ; пустая строка, если не указано"),
    zone: z.string().describe("Часовой пояс, как в документе, например «МСК» или «МСК+4»; пустая строка, если не указан"),
  }),
  who: z.array(ItemSchema).describe("Кто может участвовать: ограничения и особые требования к участникам"),
  submit: z.array(ItemSchema).describe("Что подать в заявке: документы и сведения, которые требует заказчик"),
  scope: z.array(ItemSchema).describe("Что требует ТЗ: требования к товару, работе или услуге"),
  terms: z.array(ItemSchema).describe("Сроки и деньги"),
  criteria: CriteriaSchema.describe("Как оценивают заявки: критерии, показатели, баллы"),
});

export type RequirementsDraft = z.infer<typeof RequirementsSchema>;
export type DraftItem = z.infer<typeof ItemSchema>;
export type DraftNumber = z.infer<typeof NumberSchema>;

// Выписанное требование. Всё, кроме text, source, quote и verified, — необязательное: закупки, выписанные раньше, этих полей
// не имеют, их достаёт requirementOf (requirement-engine.ts) — числа из цитаты код находит и без повторного разбора ИИ.
export type ReqExtra = {
  mandatory: Mandatory;
  type: ReqType;
  deadline: string;
  // Числовые условия, проверенные по цитате: число и слова «не менее» — из документа, не от модели.
  numbers: Condition[];
  check: string;
  evidence: string[];
};
export type ReqItem = z.infer<typeof CoreSchema> &
  Partial<ReqExtra> & {
    // Цитата найдена в документах дословно.
    verified: boolean;
    // Почему пункт стоит сверить вручную, кроме ненайденной цитаты: «числа 15 нет в цитате», «срок не найден в цитате».
    issues?: string[];
  };
export type ReqGroupKey = "who" | "submit" | "scope" | "terms";
export type ReqGroups = Record<ReqGroupKey, ReqItem[]>;
export type Deadline = RequirementsDraft["deadline"];
export type PurchaseSummary = Pick<RequirementsDraft, "short" | "subject" | "kind" | "customer" | "price" | "deadline">;
export type RequirementsResponse = PurchaseSummary & { groups: ReqGroups; criteria: Criteria };

export const REQ_GROUP_KEYS: ReqGroupKey[] = ["who", "submit", "scope", "terms"];
