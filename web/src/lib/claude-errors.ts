import Anthropic from "@anthropic-ai/sdk";

// Пользователь на хостинге не поправит ни ключ, ни баланс — ему «напишите владельцу». Что чинить, видно разработчику
// на своём компьютере (next dev) и в журнале сервера: маршруты пишут туда саму ошибку.
const DEV = process.env.NODE_ENV === "development";
export const WRITE_OWNER = "Напишите владельцу сервиса: контакты на странице «Контакты».";
const unavailable = (why: string, fix: string) => `ИИ временно недоступен: ${why}. ${DEV ? fix : WRITE_OWNER}`;

export const NO_KEY_TEXT = DEV
  ? "ИИ не подключён: добавьте ANTHROPIC_API_KEY в web/.env.local и перезапустите сервер. Пока можно посмотреть, как всё работает, на примере закупки."
  : `ИИ пока не подключён. ${WRITE_OWNER} Пока можно посмотреть, как всё работает, на примере закупки.`;

export function claudeErrorText(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return unavailable("ключ доступа к модели не подошёл", "Проверьте ANTHROPIC_API_KEY в web/.env.local.");
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return unavailable("модель отклонила запрос", "У ключа нет доступа к модели, или API недоступен из этого региона.");
  }
  // Лимиты расходов: https://platform.claude.com/docs/en/api/rate-limits#spend-limits
  if (error instanceof Anthropic.RateLimitError && /enforced_spend_limit_reached/.test(error.message)) {
    return "Исчерпан месячный лимит расходов на ИИ по тарифу Anthropic — ИИ заработает с 1-го числа следующего месяца. Напишите владельцу сервиса: контакты на странице «Контакты».";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Слишком много запросов к модели — повторите через минуту.";
  }
  if (error instanceof Anthropic.BadRequestError && /specified (workspace )?API usage limits/i.test(error.message)) {
    return "Исчерпан месячный лимит расходов на ИИ, который задал владелец сервиса. Напишите ему: контакты на странице «Контакты».";
  }
  if (error instanceof Anthropic.BadRequestError && /credit balance/i.test(error.message)) {
    return unavailable("закончился оплаченный баланс", "Пополните баланс в Claude Console, раздел Billing.");
  }
  if (error instanceof Anthropic.NotFoundError) {
    return unavailable("модель не найдена", "Проверьте CLAUDE_MODEL в src/lib/claude.ts: модель может быть недоступна для этого ключа.");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Нет связи с Anthropic — проверьте интернет и повторите.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Ошибка модели (${error.status ?? "без кода"}) — повторите запрос.`;
  }
  return "Не удалось получить ответ — повторите запрос.";
}
