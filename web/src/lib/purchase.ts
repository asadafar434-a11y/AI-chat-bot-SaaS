import type { ChatMessage } from "@/lib/chat-types";
import type { PartKey } from "@/lib/my-docs";
import type { PartDoc } from "@/lib/part-doc";
import type { FailedFile, SentDocument } from "@/lib/read-documents";
import type { PurchaseSummary, ReqGroups, RequirementsResponse } from "@/lib/requirements";
import { NO_ANTI_DUMPING, PLAIN_FORM, type TpItem, type TpResult } from "@/lib/tp";

// Часть заявки, которую ИИ написал по образцам. basisKey — отпечаток того, из чего она составлена:
// форма заказчика, реквизиты, цена, образцы. Изменилось что-то из этого — часть составляется заново.
export type PurchasePart = { doc: PartDoc; basisKey: string };

export type Purchase = PurchaseSummary & {
  id: string;
  createdAt: string;
  sample?: boolean;
  files: string[];
  unreadable: FailedFile[];
  requirements: ReqGroups;
  tp?: TpResult;
  // Цена, которую участник вписал в заявку, в рублях.
  tpPrice?: number;
  parts?: Partial<Record<PartKey, PurchasePart>>;
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

export const fromRequirements = ({ groups, ...summary }: RequirementsResponse) => ({ ...summary, requirements: groups });

export const titleOf = (p: Purchase) => p.short || p.subject || p.files[0] || "Закупка без названия";

// Первые черновики ТП хранились списком пунктов — такие закупки открываем как ТП без формы заказчика.
export function upgradePurchase(p: Purchase): Purchase {
  const tp: unknown = p.tp;
  if (!Array.isArray(tp)) return p;
  return { ...p, tp: { form: PLAIN_FORM, goods: [], items: tp as TpItem[], antiDumping: NO_ANTI_DUMPING } };
}
