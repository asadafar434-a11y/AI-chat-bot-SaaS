// Ошибки Anthropic — понятным текстом, в том числе лимиты расходов — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { claudeErrorText } from "./claude-errors.ts";

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
