// Ошибки Anthropic — понятным текстом, в том числе лимиты расходов — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { claudeErrorText, NO_KEY_TEXT } from "./claude-errors.ts";

// Тело ответа — как в документации: https://platform.claude.com/docs/en/api/rate-limits#spend-limits
const body = (type: string, message: string, details?: object) => ({ type: "error", error: { type, message, ...(details && { details }) } });

test("исчерпан лимит тарифа — не «повторите через минуту»", () => {
  const error = new Anthropic.RateLimitError(
    429,
    body("rate_limit_error", "You have reached your API usage limits: your organization has crossed its monthly API usage threshold", {
      error_code: "enforced_spend_limit_reached",
    }),
    undefined,
    new Headers()
  );
  assert.match(claudeErrorText(error), /месячный лимит расходов на ИИ по тарифу/);
});

test("исчерпан лимит, который задал владелец", () => {
  const own = new Anthropic.BadRequestError(400, body("invalid_request_error", "You have reached your specified API usage limits."), undefined, new Headers());
  const workspace = new Anthropic.BadRequestError(
    400,
    body("invalid_request_error", "You have reached your specified workspace API usage limits."),
    undefined,
    new Headers()
  );
  assert.match(claudeErrorText(own), /который задал владелец/);
  assert.match(claudeErrorText(workspace), /который задал владелец/);
});

test("обычный лимит частоты — повторить через минуту", () => {
  const error = new Anthropic.RateLimitError(429, body("rate_limit_error", "Number of requests has exceeded your per-minute rate limit"), undefined, new Headers());
  assert.match(claudeErrorText(error), /повторите через минуту/);
});

test("пользователю — «напишите владельцу», а не имя переменной и файл настроек (аудит, п. 25)", () => {
  const errors = [
    new Anthropic.AuthenticationError(401, body("authentication_error", "invalid x-api-key"), undefined, new Headers()),
    new Anthropic.PermissionDeniedError(403, body("permission_error", "Request not allowed"), undefined, new Headers()),
    new Anthropic.BadRequestError(400, body("invalid_request_error", "Your credit balance is too low"), undefined, new Headers()),
    new Anthropic.NotFoundError(404, body("not_found_error", "model: claude-x"), undefined, new Headers()),
  ];
  for (const error of errors) {
    const text = claudeErrorText(error);
    assert.match(text, /^ИИ временно недоступен: .+ Напишите владельцу сервиса/);
    assert.doesNotMatch(text, /ANTHROPIC_API_KEY|\.env|Billing|console|CLAUDE_MODEL/);
  }
  assert.doesNotMatch(NO_KEY_TEXT, /ANTHROPIC_API_KEY|\.env/);
  assert.match(NO_KEY_TEXT, /Напишите владельцу сервиса/);
});
