// Загрузить закупки из Ростендера сейчас: npm run tenders:sync [-- --max=40]
// То же, что сервер делает сам раз в сутки (src/server/rostender/schedule.ts). Нужны ROSTENDER_API_KEY и DATABASE_URL (web/.env.local). Тратит запросы дневного лимита ключа
// (страницы списка и каждая новая карточка по 1); --max ограничивает число новых карточек; --reserve=0 тратит весь лимит (по умолчанию 10 остаётся в запасе). ИИ не используется.

import { disconnectPrisma, getPrismaClient } from "../src/server/db/client.ts";
import { createRostenderClient } from "../src/server/rostender/client.ts";
import { moscowToday } from "../src/server/rostender/schedule.ts";
import { createTenderStore, type TenderDb } from "../src/server/rostender/store.ts";
import { syncTenders } from "../src/server/rostender/sync.ts";

const max = Number(process.argv.find((a) => a.startsWith("--max="))?.slice(6));
const reserveArg = process.argv.find((a) => a.startsWith("--reserve="))?.slice(10);
const reserve = reserveArg !== undefined && Number.isFinite(Number(reserveArg)) && Number(reserveArg) >= 0 ? Number(reserveArg) : undefined;
const key = process.env.ROSTENDER_API_KEY?.trim();
if (!key || !process.env.DATABASE_URL) {
  console.error("Нужны ROSTENDER_API_KEY и DATABASE_URL в web/.env.local и запущенная база.");
  process.exit(1);
}
try {
  const store = createTenderStore(getPrismaClient() as unknown as TenderDb);
  const r = await syncTenders({ client: createRostenderClient({ apiKey: key }), store, today: moscowToday(), reserve, maxCards: Number.isFinite(max) && max > 0 ? max : undefined });
  console.log(JSON.stringify(r, null, 2));
} finally {
  await disconnectPrisma();
}
