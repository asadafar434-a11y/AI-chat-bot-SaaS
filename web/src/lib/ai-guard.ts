import "server-only";
import { currentSession } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/auth/request";
import { costUsd, rubOf, usdText, type AiUsage } from "@/lib/ai-cost";
import { createBudget, createDedup } from "@/lib/ai-meter";

// Контроль расходов на ИИ на сервере: журнал стоимости каждого ответа модели, бюджет на заявку
// и склейка одинаковых одновременных запросов. Всё — в памяти процесса: сервер не хранит ни документов,
// ни ответов, только номер заявки и потраченную сумму (ai-meter.ts).
//
// Бюджет включается, когда задан курс доллара USD_RUB: цены модели — в долларах, бюджет — в рублях,
// AI_BUDGET_RUB (по умолчанию 250 ₽ на заявку). Курс в код не зашит — он меняется.
const usdRub = Number(process.env.USD_RUB) || 0;
const budgetRub = Number(process.env.AI_BUDGET_RUB) || 250;
const budget = usdRub > 0 && budgetRub > 0 ? createBudget(budgetRub / usdRub) : null;

export const dedup = createDedup();

/**
 * CSRF + сессионная проверка для AI-маршрутов.
 * Возвращает Response(401) при отказе, null при успехе.
 * Сессия требуется только когда AUTH_SECRET задан (production/dev с DB):
 * в dev без БД пропускаем, чтобы не сломать тестирование.
 */
export async function requireAiAuth(request: Request): Promise<Response | null> {
  if (!isSameOrigin(request)) {
    return new Response("Требуется вход", { status: 401 });
  }
  if (process.env.AUTH_SECRET) {
    try {
      if (!(await currentSession())) return new Response("Требуется вход", { status: 401 });
    } catch {
      // БД недоступна (dev без миграций) — пропускаем; rate-limit всё равно работает
    }
  }
  return null;
}

// Номер заявки приходит от браузера в заголовке: закупка — это и есть заявка. Без номера — только общий журнал.
export const appIdOf = (request: Request) => (request.headers.get("x-application-id") ?? "").trim().slice(0, 100) || null;

export const budgetOver = (appId: string | null) => !!budget && !!appId && budget.left(appId) <= 0;

export const BUDGET_TEXT =
  "На эту заявку потрачен весь бюджет ИИ. Всё, что уже сделано, сохранено: смотрите, правьте и скачивайте документы. Новые запросы к ИИ по этой закупке — через владельца сервиса.";

// Журнал расходов: строка на каждый ответ модели — что за операция, модель, токены и цена.
// Это журнал хостинга, как у остальных строк сервера; документов и ответов в нём нет.
export function chargeAi(label: string, appId: string | null, message: { model: string; usage: AiUsage }): number {
  const { usd, known } = costUsd(message.model, message.usage);
  if (budget && appId) budget.charge(appId, usd);
  const rub = usdRub ? ` ≈ ${rubOf(usd, usdRub)} ₽` : "";
  const app = appId && budget ? ` · заявка ${appId}: потрачено ${rubOf(budget.spent(appId), usdRub)} из ${budgetRub} ₽` : appId ? ` · заявка ${appId}` : "";
  console.log(`[ИИ] ${label} ${message.model}: ${usdText(usd)}${rub}${known ? "" : " (цены модели нет в таблице — по самой дорогой)"}${app}`);
  return usd;
}
