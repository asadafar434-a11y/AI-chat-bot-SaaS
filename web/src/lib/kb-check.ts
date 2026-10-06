import "server-only";
import { localEmbedder } from "./kb-embed.ts";
import { retrieveKnowledgeBlock } from "./kb-rag.ts";
import { createDbKbStore } from "./kb-store-db.ts";
import { getDb } from "../server/db/client.ts";

// База знаний в запросах к модели. Каждый раздел включается своим флагом и только при настроенной базе (DATABASE_URL):
// KB_CHECK — проверка заявки, KB_DOCS — ТП и требования к участнику. Если база недоступна, раздел работает как раньше.

export const CHECK_KB_QUERY = "требования к заявке участника, состав заявки, декларация о соответствии, сроки подачи, обеспечение заявки, техническое предложение, предложение о цене";
export const DRAFT_TP_KB_QUERY = "техническое предложение участника, характеристики товара или услуги, сроки исполнения, гарантия, условия оплаты, стоимость, требования заказчика к предложению участника";
export const DRAFT_REQ_KB_QUERY = "требования к участникам закупки, состав заявки, документы участника, декларация о соответствии, сроки подачи, обеспечение заявки, критерии оценки";

// Правило приоритета для модели: справка не переопределяет закупку и не становится значением участника.
export const KB_NOTE =
  "Фрагменты базы знаний — справка, не документы закупки. При расхождении верны документы закупки. Значения из справки не переносить в предложение участника как требования заказчика и не подставлять вместо границ, которые задал заказчик.";

export type KbFlag = "KB_CHECK" | "KB_DOCS";

export const knowledgeEnabled = (flag: KbFlag) => process.env[flag] === "on" && Boolean(process.env.DATABASE_URL);
export const knowledgeForCheckEnabled = () => knowledgeEnabled("KB_CHECK");

export async function knowledgeBlock(flag: KbFlag, query: string, label: string, maxChars = 4000): Promise<string | null> {
  if (!knowledgeEnabled(flag)) return null;
  try {
    return await retrieveKnowledgeBlock(
      { store: createDbKbStore(getDb()), embedder: localEmbedder },
      { query, visibility: { organizationId: null }, label, maxChars },
    );
  } catch (error) {
    console.error(`[БЗ] ${label}: без базы знаний —`, error instanceof Error ? error.message : error);
    return null;
  }
}

export const checkKnowledgeBlock = () => knowledgeBlock("KB_CHECK", CHECK_KB_QUERY, "check");
export const draftKnowledgeBlock = (query: string) => knowledgeBlock("KB_DOCS", query, "draft");

/** Блок для модели: правило приоритета и сами фрагменты. */
export const knowledgeTextBlock = (text: string) => ({ type: "text" as const, text: `${KB_NOTE}\n\n${text}` });
