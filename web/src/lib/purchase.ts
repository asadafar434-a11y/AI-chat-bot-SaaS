import type { ChatMessage } from "@/lib/chat-types";
import { errorText } from "@/lib/http-error";
import type { CheckResult } from "@/lib/check";
import type { PartKey } from "@/lib/my-docs";
import type { PartDoc } from "@/lib/part-doc";
import type { PriceCalc } from "@/lib/price-floor";
import type { FailedFile, SentDocument } from "@/lib/read-documents";
import type { Criteria } from "@/lib/criteria";
import type { PurchaseSummary, ReqGroups, RequirementsResponse } from "@/lib/requirements";
import type { TpResult } from "@/lib/tp";

// Часть заявки, которую ИИ написал по образцам. basisKey — отпечаток того, из чего она составлена:
// форма заказчика, реквизиты, цена, образцы. Изменилось что-то из этого — часть составляется заново.
export type PurchasePart = { doc: PartDoc; basisKey: string };

export type Purchase = PurchaseSummary & {
  id: string;
  createdAt: string;
  sample?: boolean;
  // Версия примера, по которой он сохранён в браузере (sample-purchase.ts).
  sampleVersion?: number;
  files: string[];
  // Какие из файлов распознаны со скана. Хранится рядом с закупкой, чтобы главная не читала тексты документов.
  scans?: string[];
  unreadable: FailedFile[];
  requirements: ReqGroups;
  // Критерии оценки заявок. Закупки, выписанные до них, критериев не имеют — их покажет повторный разбор.
  criteria?: Criteria;
  tp?: TpResult;
  // ТП, как его составил ИИ, — до правок участника: по нему видно, какие жёлтые места вписаны (lib/fields.ts).
  tpDraft?: TpResult;
  // Что участник вписал в мастере заполнения сверх ТП и реквизитов — например, строки анкеты заказчика.
  fieldValues?: Record<string, string>;
  // Что участник подтвердил: подписанта, цену, договоры для опыта, цифры из скана (ключи полей lib/fields.ts).
  confirmed?: string[];
  // Цена, которую участник вписал в заявку, в рублях.
  tpPrice?: number;
  // Что участник вписал в «До какой цены снижаться». Только изменённые поля: остальное берётся из закупки.
  priceCalc?: Partial<PriceCalc>;
  parts?: Partial<Record<PartKey, PurchasePart>>;
  // Последняя проверка заявки перед подачей.
  check?: CheckResult;
  // Какие документы из «Что подать» участник отметил готовыми — по тексту пункта (lib/application-files.ts).
  submitReady?: string[];
  chat?: ChatMessage[];
  // Участник отметил, что подал заявку на площадке: закупка уходит из «В работе» в «Поданы».
  submitted?: boolean;
};

// Заголовки запроса к ИИ по закупке: номер закупки — это номер заявки, по нему сервер ведёт бюджет ИИ.
export const aiHeaders = (purchaseId?: string) => ({
  "Content-Type": "application/json",
  ...(purchaseId && { "x-application-id": purchaseId }),
});

// Требования выписываются при создании закупки и заново — когда к ней добавляют документы.
export async function extractRequirements(documents: SentDocument[], purchaseId?: string): Promise<RequirementsResponse> {
  const res = await fetch("/api/requirements", {
    method: "POST",
    headers: aiHeaders(purchaseId),
    body: JSON.stringify({ documents }),
  });
  if (!res.ok) throw new Error(await errorText(res, "Не удалось выписать требования."));
  return res.json();
}

export const fromRequirements = ({ groups, criteria, ...summary }: RequirementsResponse) => ({ ...summary, requirements: groups, criteria });

export const titleOf = (p: Purchase) => p.short || p.subject || p.files[0] || "Закупка без названия";
