import Anthropic from "@anthropic-ai/sdk";

export const NO_KEY_TEXT =
  "ИИ пока не подключён: нужен ключ Anthropic в web/.env.local. Пока можно посмотреть, как всё работает, на примере закупки.";

export function claudeErrorText(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Ключ Anthropic не подошёл — проверьте ANTHROPIC_API_KEY в web/.env.local.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "Anthropic отклонил запрос: у ключа нет доступа к модели или API недоступен из этого региона.";
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
    return "На счёте Anthropic нет денег — пополните баланс в консоли, раздел Billing.";
  }
  if (error instanceof Anthropic.NotFoundError) {
    return "Модель не найдена — возможно, она недоступна для этого ключа.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Нет связи с Anthropic — проверьте интернет и повторите.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Ошибка модели (${error.status ?? "без кода"}) — повторите запрос.`;
  }
  return "Не удалось получить ответ — повторите запрос.";
}
