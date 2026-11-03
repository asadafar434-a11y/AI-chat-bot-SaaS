import { hitStoreSource } from "@/lib/limit-stores";
import { clientIp, LOGIN_PER_IP, TWO_FACTOR_PER_USER, waitText } from "@/lib/rate-limit";
import { sharedLimiter } from "@/lib/shared-limits";
import { isSameOrigin } from "@/server/auth/request";
import { createSession } from "@/server/auth/session";
import { sessionResponse } from "@/server/auth/session-response";
import { readChallenge } from "@/server/auth/totp";
import { lockedMessage, verifySecondFactor } from "@/server/auth/two-factor";
import { getDb } from "@/server/db/client";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const perIp = sharedLimiter("login-ip", LOGIN_PER_IP, hitStoreSource);
const perUser = sharedLimiter("login-2fa-user", TWO_FACTOR_PER_USER, hitStoreSource);

const tooMany = (later: number) =>
  new Response(`Слишком много попыток — попробуйте ${waitText(later)}.`, {
    status: 429,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(later) },
  });

/**
 * Второй шаг входа: POST { challenge, code }. «Пропуск» выдан после верного пароля (`/api/auth/login`), код — из приложения-аутентификатора,
 * PIN из 4 цифр или запасной. Каждая попытка (даже с неверным пропуском) идёт в счёт и по адресу, и по человеку: шесть цифр иначе подбираются.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response("Недопустимый источник запроса", { status: 403 });
  }
  const ipWait = await perIp(clientIp(request.headers.get("x-forwarded-for")));
  if (ipWait) return tooMany(ipWait);

  const body = (await request.json().catch(() => null)) as { challenge?: unknown; code?: unknown } | null;
  const userId = readChallenge(body?.challenge);
  if (!userId) {
    return new Response("Время на ввод кода вышло — войдите заново.", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const userWait = await perUser(userId);
  if (userWait) return tooMany(userWait);

  const db = getDb();
  const result = await verifySecondFactor(db, userId, body?.code);
  if (typeof result === "object") {
    return new Response(lockedMessage(result.locked), { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(result.locked) } });
  }
  if (result !== "ok") {
    await wait(800);
    return new Response("Код не подошёл. Введите код ещё раз или запасной код.", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const { token } = await createSession(db, { userId });
  return sessionResponse(request, token);
}
