import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { hitStoreSource } from "@/lib/limit-stores";
import { clientIp, RESET_PER_EMAIL, RESET_PER_IP, waitText } from "@/lib/rate-limit";
import { sharedLimiter } from "@/lib/shared-limits";
import { tryNormalizeEmail } from "@/server/auth/email";
import { AuthError } from "@/server/auth/errors";
import { resetPasswordWithToken } from "@/server/auth/password-reset";
import { isSameOrigin } from "@/server/auth/request";
import { requestPasswordReset } from "@/server/auth/reset-request";
import { getDb, getTransactionRunner } from "@/server/db/client";
import { mailerFromEnv } from "@/server/mail/mailer";

const perIp = sharedLimiter("reset-ip", RESET_PER_IP, hitStoreSource);
const perEmail = sharedLimiter("reset-email", RESET_PER_EMAIL, hitStoreSource);

const tooMany = (text: string, seconds: number) =>
  new Response(text, { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(seconds) } });

/**
 * Сброс пароля.
 *
 * POST — запрос ссылки («забыли пароль»). Ответ не зависит от того, есть ли такой аккаунт, чтобы по нему нельзя было
 * перебирать почты: письмо уходит только существующему, но ответ всегда `{ ok: true, mail }`, где `mail` — настроена ли на
 * сервере отправка писем (одно значение для всех). Ссылка составляется из AUTH_URL, а не из заголовков запроса.
 * При `AUTH_EXPOSE_TOKENS=1` токен возвращается клиенту — только для отладки.
 *
 * PUT — применение нового пароля по одноразовому токену. Успешный сброс завершает все
 * активные сессии пользователя.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response("Недопустимый источник запроса", { status: 403 });
  }

  const byIp = await perIp(clientIp(request.headers.get("x-forwarded-for")));
  if (byIp) return tooMany(`Слишком много запросов — попробуйте ${waitText(byIp)}.`, byIp);

  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  // Лимит на почту считается по любой правдоподобной почте, существует она или нет, и хранится в виде хеша.
  const email = tryNormalizeEmail(body?.email);
  if (email) {
    const byMail = await perEmail(createHash("sha256").update(email).digest("hex"));
    if (byMail) return tooMany(`Ссылку на эту почту уже отправляли — попробуйте ещё раз ${waitText(byMail)}.`, byMail);
  }

  const baseUrl = process.env.AUTH_URL?.trim() || null;
  const result = await requestPasswordReset(
    { db: getDb(), mailer: mailerFromEnv(), baseUrl, log: (message) => console.error(message) },
    body?.email,
  );
  // Письмо отправляется в фоне: ответ не ждёт почтовый сервер и не выдаёт, существует ли аккаунт.
  void result.delivery;
  return NextResponse.json(
    {
      ok: true,
      mail: result.mail,
      ...(process.env.AUTH_EXPOSE_TOKENS === "1" && result.token ? { token: result.token } : {}),
    },
    { status: 202 },
  );
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response("Недопустимый источник запроса", { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => null)) as { token?: unknown; password?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const result = await resetPasswordWithToken(getTransactionRunner(), token, body?.password);
    return NextResponse.json({ ok: true, userId: result.userId });
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}
