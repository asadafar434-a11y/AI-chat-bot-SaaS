import "server-only";
import { localEmbedder } from "./kb-embed.ts";
import { retrieveKnowledgeBlock } from "./kb-rag.ts";
import { createDbKbStore } from "./kb-store-db.ts";
import { getDb } from "../server/db/client.ts";

// Проверка заявки получает фрагменты общей базы знаний: нормативные статьи и примеры заполнения.
// Включается переменной KB_CHECK=on и только при настроенной базе (DATABASE_URL). Если база недоступна,
// проверка идёт как раньше: база помогает, но не должна ломать проверку.

// Запрос поиска: о том, что обычно проверяют в заявке. Документы самой закупки в поиск не попадают.
export const CHECK_KB_QUERY = "требования к заявке участника, состав заявки, декларация о соответствии, сроки подачи, обеспечение заявки, техническое предложение, предложение о цене";

export const knowledgeForCheckEnabled = () => process.env.KB_CHECK === "on" && Boolean(process.env.DATABASE_URL);

export async function checkKnowledgeBlock(): Promise<string | null> {
  if (!knowledgeForCheckEnabled()) return null;
  try {
    return await retrieveKnowledgeBlock(
      { store: createDbKbStore(getDb()), embedder: localEmbedder },
      { query: CHECK_KB_QUERY, visibility: { organizationId: null }, label: "check", maxChars: 4000 },
    );
  } catch (error) {
    console.error("[БЗ] проверка без базы знаний:", error instanceof Error ? error.message : error);
    return null;
  }
}
