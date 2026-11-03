import { hitStoreSource } from "@/lib/limit-stores";
import { clientIp, LOGIN_PER_IP, TWO_FACTOR_PER_USER, waitText } from "@/lib/rate-limit";
import { sharedLimiter } from "@/lib/shared-limits";
import { AuthError } from "@/server/auth/errors";
import { requireSession } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/auth/request";
import { beginSetup, confirmSetup, disableTwoFactor, enablePin, renewRecoveryCodes, twoFactorStatus } from "@/server/auth/two-factor";
import { getDb } from "@/server/db/client";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const perIp = sharedLimiter("login-ip", LOGIN_PER_IP, hitStoreSource);
const perUser = sharedLimiter("login-2fa-user", TWO_FACTOR_PER_USER, hitStoreSource);

const plain = (message: string, status: number, extra: Record<string, string> = {}) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...extra } });

async function session() {
  try {
    return await requireSession();
  } catch (error) {
    if (error instanceof AuthError) return plain("Нужно войти.", error.status);
    throw error;
  }
}

/** Состояние для «Настроек»: включён ли второй шаг и сколько запасных кодов осталось. */
export async function GET() {
  const who = await session();
  if (who instanceof Response) return who;
  return Response.json(await twoFactorStatus(getDb(), who.userId), { headers: { "Cache-Control": "no-store" } });
}

/**
 * Управление вошедшего: POST { action }
 *  - "setup" — выдать секрет и ссылку для приложения (вход пока не меняется);
 *  - "enable", code — подтвердить первым кодом: включается, в ответе запасные коды (показываются один раз);
 *  - "enable-pin", pin, password — включить PIN из 4 цифр вместо приложения (нужен пароль; в ответе запасные коды);
 *  - "disable", password, code — выключить (нужны и пароль, и код, PIN или запасной код);
 *  - "recovery", code — выпустить новые запасные коды вместо прежних.
 * Неверные коды считаются в тот же счётчик, что и при входе.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return plain("Недопустимый источник запроса", 403);
  const who = await session();
  if (who instanceof Response) return who;

  const ipWait = await perIp(clientIp(request.headers.get("x-forwarded-for")));
  if (ipWait) return plain(`Слишком много попыток — попробуйте ${waitText(ipWait)}.`, 429, { "Retry-After": String(ipWait) });

  const body = (await request.json().catch(() => null)) as { action?: unknown; code?: unknown; password?: unknown; pin?: unknown } | null;
  const db = getDb();
  try {
    if (body?.action === "setup") {
      return Response.json(await beginSetup(db, who.userId), { headers: { "Cache-Control": "no-store" } });
    }
    const userWait = await perUser(who.userId);
    if (userWait) return plain(`Слишком много попыток — попробуйте ${waitText(userWait)}.`, 429, { "Retry-After": String(userWait) });

    if (body?.action === "enable") {
      return Response.json({ recoveryCodes: await confirmSetup(db, who.userId, body.code) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body?.action === "enable-pin") {
      return Response.json({ recoveryCodes: await enablePin(db, who.userId, { pin: body.pin, password: body.password }) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body?.action === "disable") {
      await disableTwoFactor(db, who.userId, { password: body.password, code: body.code });
      return new Response(null, { status: 204 });
    }
    if (body?.action === "recovery") {
      return Response.json({ recoveryCodes: await renewRecoveryCodes(db, who.userId, body.code) }, { headers: { "Cache-Control": "no-store" } });
    }
    return plain("Неизвестное действие.", 400);
  } catch (error) {
    if (error instanceof AuthError) {
      await wait(800);
      return plain(error.message.replace(/^AuthError\([a-z_]+\):\s*/, ""), error.status);
    }
    throw error;
  }
}
