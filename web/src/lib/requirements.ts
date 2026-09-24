import * as z from "zod/v4";

const ItemSchema = z.object({
  text: z.string().describe("Пункт одной строкой простыми словами — с числами, датами и суммами из документа"),
  source: z.string().describe("Где это написано, коротко: «Извещение, раздел 4», «ТЗ, п. 2.1», «Проект контракта, п. 2.5»"),
  quote: z.string().describe("Дословная цитата из документа, на которой основан пункт"),
});

export const RequirementsSchema = z.object({
  subject: z.string().describe("Предмет закупки одной строкой; пустая строка, если не указан"),
  kind: z.string().describe("Закон и способ закупки, например «44-ФЗ · электронный аукцион»; пустая строка, если не указано"),
  deadline: z.object({
    date: z.string().describe("Дата окончания подачи заявок в формате ГГГГ-ММ-ДД; пустая строка, если её нет в документах"),
    time: z.string().describe("Время окончания подачи заявок в формате ЧЧ:ММ; пустая строка, если не указано"),
    zone: z.string().describe("Часовой пояс, как в документе, например «МСК» или «МСК+4»; пустая строка, если не указан"),
  }),
  who: z.array(ItemSchema).describe("Кто может участвовать: ограничения и особые требования к участникам"),
  submit: z.array(ItemSchema).describe("Что подать в заявке и за что дают баллы"),
  scope: z.array(ItemSchema).describe("Что требует ТЗ: требования к товару, работе или услуге"),
  terms: z.array(ItemSchema).describe("Сроки и деньги"),
});

export type RequirementsDraft = z.infer<typeof RequirementsSchema>;
export type ReqItem = z.infer<typeof ItemSchema> & { verified: boolean };
export type ReqGroupKey = "who" | "submit" | "scope" | "terms";
export type Deadline = RequirementsDraft["deadline"];

export type RequirementsResponse = {
  mode: "ai" | "demo";
  notice?: string;
  subject: string;
  kind: string;
  deadline: Deadline;
  groups: Record<ReqGroupKey, ReqItem[]>;
};
