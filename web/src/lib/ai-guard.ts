import "server-only";
import { aiAuthDenial, type AiAuthState } from "@/lib/ai-auth";
import { currentSession } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/auth/request";
import { costUsd, rubOf, usdText, type AiUsage } from "@/lib/ai-cost";
import { createDedup } from "@/lib/ai-meter";
import { spendStoreSource } from "@/lib/limit-stores";
import { sharedBudget } from "@/lib/shared-limits";

// Контроль расходов на ИИ на сервере: журнал стоимости каждого ответа модели, бюджет на заявку
// и склейка одинаковых одновременных запросов. Всё — в памяти процесса: сервер не хранит ни документов,
// ни ответов, только номер заявки и потраченную сумму (ai-meter.ts).
//
// Бюджет включается, когда задан курс доллара USD_RUB: цены модели — в долларах, бюджет — в рублях,
// AI_BUDGET_RUB (по умолчанию 250 ₽ на заявку). Курс в код не зашит — он меняется.
const usdRub = Number(process.env.USD_RUB) || 0;
const budgetRub = Number(process.env.AI_BUDGET_RUB) || 250;
// Счёт — в памяти сервера или, при SHARED_LIMITS=db, общий для нескольких серверов (shared-limits.ts).
const budget = usdRub > 0 && budgetRub > 0 ? sharedBudget(budgetRub / usdRub, spendStoreSource) : null;

export const dedup = createDedup();

/**
 * CSRF + сессионная проверка для маршрутов, которые тратят ИИ или читают файлы участника.
 * Возвращает Response(401/503) при отказе, null при успехе. Решение — в ai-auth.ts (там и правила, и тесты).
 * Сессия требуется только когда AUTH_SECRET задан (хостинг или репетиция с базой).
 * Если базу не удалось спросить: на компьютере разработчика без базы пропускаем, в боевом режиме — 503.
 */
export async function requireAiAuth(request: Request): Promise<Response | null> {
  const sessionRequired = Boolean(process.env.AUTH_SECRET);
  let session: AiAuthState["session"] = "none";
  if (sessionRequired) {
    try {
      session = (await currentSession()) ? "valid" : "none";
    } catch {
      session = "unavailable";
    }
  }
  const denial = aiAuthDenial({ sameOrigin: isSameOrigin(request), sessionRequired, session, production: process.env.NODE_ENV === "production" });
  return denial ? new Response(denial.text, { status: denial.status }) : null;
}

// Номер заявки приходит от браузера в заголовке: закупка — это и есть заявка. Без номера — только общий журнал.
export const appIdOf = (request: Request) => (request.headers.get("x-application-id") ?? "").trim().slice(0, 100) || null;

export const budgetOver = async (appId: string | null): Promise<boolean> => !!budget && !!appId && (await budget.left(appId)) <= 0;

export const BUDGET_TEXT =
  "На эту заявку потрачен весь бюджет ИИ. Всё, что уже сделано, сохранено: смотрите, правьте и скачивайте документы. Новые запросы к ИИ по этой закупке — через владельца сервиса.";

// Журнал расходов: строка на каждый ответ модели — что за операция, модель, токены и цена.
// Это журнал хостинга, как у остальных строк сервера; документов и ответов в нём нет.
// extraUsd — плата не за токены, а за встроенный поиск модели ($0,01 за поисковый запрос): она тоже идёт в бюджет закупки.
export function chargeAi(label: string, appId: string | null, message: { model: string; usage: AiUsage }, extraUsd = 0): number {
  const costed = costUsd(message.model, message.usage);
  const known = costed.known;
  const usd = costed.usd + extraUsd;
  if (budget && appId) budget.charge(appId, usd);
  const rub = usdRub ? ` ≈ ${rubOf(usd, usdRub)} ₽` : "";
  const app = appId && budget ? ` · заявка ${appId}: потрачено ${rubOf(budget.spentHere(appId), usdRub)} из ${budgetRub} ₽` : appId ? ` · заявка ${appId}` : "";
  console.log(`[ИИ] ${label} ${message.model}: ${usdText(usd)}${rub}${known ? "" : " (цены модели нет в таблице — по самой дорогой)"}${app}`);
  return usd;
}
