import { NextResponse } from "next/server";

import { AuthError } from "@/server/auth/errors";
import { createPasswordResetToken, resetPasswordWithToken } from "@/server/auth/password-reset";
import { isSameOrigin } from "@/server/auth/request";
import { getDb, getTransactionRunner } from "@/server/db/client";

/**
 * Сброс пароля.
 *
 * POST — запрос ссылки. Ответ всегда одинаковый, независимо от существования аккаунта,
 * чтобы по нему нельзя было перебирать email. Если письмо ещё не отправляется (этап S8),
 * при `AUTH_EXPOSE_TOKENS=1` токен возвращается клиенту для отладки.
 *
 * PUT — применение нового пароля по одноразовому токену. Успешный сброс завершает все
 * активные сессии пользователя.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response("Недопустимый источник запроса", { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const result = await createPasswordResetToken(getDb(), body?.email);
  return NextResponse.json(
    {
      ok: true,
      ...(process.env.AUTH_EXPOSE_TOKENS === "1" && result ? { token: result.token } : {}),
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
