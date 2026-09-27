import type { ChatMessage } from "@/lib/chat-types";
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
  // Цена, которую участник вписал в заявку, в рублях.
  tpPrice?: number;
  // Что участник вписал в «До какой цены снижаться». Только изменённые поля: остальное берётся из закупки.
  priceCalc?: Partial<PriceCalc>;
  parts?: Partial<Record<PartKey, PurchasePart>>;
  // Последняя проверка заявки перед подачей.
  check?: CheckResult;
  chat?: ChatMessage[];
};

// Требования выписываются при создании закупки и заново — когда к ней добавляют документы.
export async function extractRequirements(documents: SentDocument[]): Promise<RequirementsResponse> {
  const res = await fetch("/api/requirements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documents }),
  });
  if (!res.ok) throw new Error((await res.text()) || "Не удалось выписать требования.");
  return res.json();
}

export const fromRequirements = ({ groups, criteria, ...summary }: RequirementsResponse) => ({ ...summary, requirements: groups, criteria });

export const titleOf = (p: Purchase) => p.short || p.subject || p.files[0] || "Закупка без названия";
