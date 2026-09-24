import Anthropic from "@anthropic-ai/sdk";

export function claudeErrorText(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Ключ Anthropic не подошёл — проверьте ANTHROPIC_API_KEY в web/.env.local.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "Anthropic отклонил запрос: у ключа нет доступа к модели или API недоступен из этого региона.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Слишком много запросов к модели — повторите через минуту.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Нет связи с Anthropic — проверьте интернет и повторите.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Ошибка модели (${error.status ?? "без кода"}) — повторите запрос.`;
  }
  return "Не удалось получить ответ — повторите запрос.";
}
