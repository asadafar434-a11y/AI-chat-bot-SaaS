// Статьи 44-ФЗ и 223-ФЗ в базу знаний: npm run kb:laws -- --approver=Имя
// Источник текста — src/data/laws/*.json (с портала pravo.gov.ru, обновляется scripts/fetch-laws.mjs).
// Бесплатно: эмбеддинги считаются локально, запросов к ИИ нет. Повторный запуск без изменений текста
// законов ничего не пересчитывает.

import { seedLawsIntoKnowledgeBase } from "../src/lib/kb-laws.ts";
import { localEmbedder } from "../src/lib/kb-embed.ts";
import { createDbKbStore } from "../src/lib/kb-store-db.ts";
import { disconnectPrisma, getDb } from "../src/server/db/client.ts";

const args = new Map(process.argv.slice(2).map((a) => {
  const [key, ...rest] = a.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));
const approver = args.get("approver");
if (!approver) throw new Error("укажите утверждающего: --approver=Имя");
if (!process.env.DATABASE_URL) throw new Error("нужна DATABASE_URL (локальная база: npm run db:up, затем npm run db:migrate:deploy)");

const store = createDbKbStore(getDb());
const summary = await seedLawsIntoKnowledgeBase(store, localEmbedder, approver);
console.log(`Законы: создано ${summary.created}, обновлено ${summary.updated}, метаданные обновлены ${summary.metadataUpdated}, без изменений ${summary.unchanged} из ${summary.documents}.`);
console.log(`Векторов посчитано заново: ${summary.embedded}, переиспользовано: ${summary.reused}.`);
await disconnectPrisma();
