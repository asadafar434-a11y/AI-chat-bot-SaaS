import "server-only";
import { GOLD_FOLDER, type GoldDoc, type GoldKind } from "./gold-folder.ts";
import { ingestDocument, type IngestResult } from "./kb-ingest.ts";
import type { Embedder } from "./kb-embed.ts";
import type { KbStore } from "./kb-store.ts";
import type { DocumentType } from "./kb-types.ts";

// Golden Dataset — эталон для проверки качества, не источник знаний. Попасть в базу знаний он может только
// явно: человек выбирает документ, утверждает его и указывает тип. Автоматически ничего не переходит.
//
// Правило по виду документа (проверяется по разметке папки «Татьяна-Примеры документов»):
// - персональные данные участника (ИП, ФИО в заявке) — никогда;
// - архивы, протоколы, заполненные участником образцы — никогда: это следы конкретной закупки или конкретного участника;
// - извещения, документация, ТЗ, бланки и прочее из закупки — только после того, как человек переписал их в общий вид
//   (не копия закупки). Флаг rewritten подтверждает именно это.

const TENDER_SPECIFIC: GoldKind[] = ["извещение", "документация", "техническое задание", "бланк заказчика", "прочее"];

export type PromotionDecision = { allowed: true } | { allowed: false; reason: string };

export function promotionDecision(entry: GoldDoc, rewritten: boolean): PromotionDecision {
  if (entry.personal) return { allowed: false, reason: "есть персональные данные участника" };
  if (entry.kind === "архив") return { allowed: false, reason: "архив не разобран" };
  if (entry.kind === "протокол") return { allowed: false, reason: "результат конкретной закупки" };
  if (entry.kind === "образец участника") return { allowed: false, reason: "заполнено конкретным участником" };
  if (TENDER_SPECIFIC.includes(entry.kind)) {
    return rewritten ? { allowed: true } : { allowed: false, reason: "материал конкретной закупки: нужно переписать в общий вид" };
  }
  return { allowed: false, reason: `неизвестный вид: ${entry.kind}` };
}

/** Разметка папки: что можно взять в базу знаний сейчас без переписывания. По умолчанию — ничего. */
export function classifyGoldFolder(entries: GoldDoc[] = GOLD_FOLDER) {
  return entries.map((entry) => ({ path: entry.path, kind: entry.kind, decision: promotionDecision(entry, false) }));
}

export type PromoteInput = {
  entry: GoldDoc;
  /** Текст, который человек утверждает для базы: не копия закупки, а общий вид. */
  text: string;
  documentType: DocumentType;
  approvedBy: string;
  rewritten: boolean;
  name: string;
};

/** Явное добавление одного документа из эталона в базу знаний. Отказ — исключение с причиной. */
export async function promoteGoldDocument(store: KbStore, embedder: Embedder, input: PromoteInput): Promise<IngestResult> {
  const decision = promotionDecision(input.entry, input.rewritten);
  if (!decision.allowed) throw new Error(`в базу знаний не берём «${input.entry.path}»: ${decision.reason}`);
  return ingestDocument(store, embedder, {
    owner: { kind: "global", approvedBy: input.approvedBy },
    sourceKey: `golden:${input.entry.path}`,
    name: input.name,
    source: "golden_dataset",
    text: input.text,
    meta: { documentType: input.documentType, reliability: "verified" },
  });
}
