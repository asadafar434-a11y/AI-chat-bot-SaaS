// Вход по почте и паролю на экране продукта: запросы к готовым серверным маршрутам /api/auth/*. Без зависимостей от React и сервера,
// чтобы логику проверяли тесты. Пароль уходит только на этот же адрес сайта и нигде не сохраняется.
import { errorMessage, errorText } from "@/lib/http-error";

export type AuthUser = { id: string; email: string | null; name: string | null };

/** Особый адрес в ссылке, которую выдаёт команда owner:create: #/invite/<токен> — задать пароль, #/reset/<токен> — сменить его. */
export type AuthRoute = { kind: "invite" | "reset"; token: string };

export function authRouteOf(hash: string): AuthRoute | null {
  const [kind, token] = hash.replace(/^#\/?/, "").split("/");
  if ((kind === "invite" || kind === "reset") && token && /^[A-Za-z0-9_-]{16,200}$/.test(token)) return { kind, token };
  return null;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Кто сейчас вошёл. null — никто; ошибка сети пробрасывается, чтобы не принять «сервер недоступен» за «не вошли». */
export async function fetchSession(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/session", { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(await errorText(res, "Не удалось проверить вход."));
  const data = (await res.json().catch(() => null)) as { user?: { id?: unknown; email?: unknown; name?: unknown } } | null;
  const user = data?.user;
  if (!user || typeof user.id !== "string") return null;
  return { id: user.id, email: typeof user.email === "string" ? user.email : null, name: typeof user.name === "string" ? user.name : null };
}

// Часть серверных ответов приходит с служебной приставкой «AuthError(код): » — человеку она ни к чему.
const plainText = (text: string) => text.replace(/^AuthError\([a-z_]+\):\s*/, "");

async function expectOk(res: Response, fallback: string): Promise<void> {
  if (!res.ok) throw new Error(plainText(await errorText(res, fallback)));
}

/**
 * Вход по почте и паролю. Включён второй шаг — сервер пароль принял, но сессию не выдал: возвращается `{ challenge, method }` (пропуск на
 * 5 минут и способ: код приложения или PIN), дальше нужен код (`loginWithCode`). `null` — вход выполнен.
 */
export type SecondFactorMethod = "totp" | "pin";

export async function loginWithPassword(email: string, password: string): Promise<{ challenge: string; method: SecondFactorMethod } | null> {
  try {
    const res = await fetch("/api/auth/login", json({ email, password }));
    await expectOk(res, "Не получилось войти.");
    if (res.status === 204) return null;
    const data = (await res.json().catch(() => null)) as { twoFactor?: unknown; challenge?: unknown; method?: unknown } | null;
    return data?.twoFactor === true && typeof data.challenge === "string" ? { challenge: data.challenge, method: data.method === "pin" ? "pin" : "totp" } : null;
  } catch (error) {
    throw new Error(errorMessage(error, "Не получилось войти."));
  }
}

/** Второй шаг входа: код из приложения-аутентификатора, PIN или запасной код. */
export async function loginWithCode(challenge: string, code: string): Promise<void> {
  try {
    await expectOk(await fetch("/api/auth/login/2fa", json({ challenge, code })), "Не получилось войти.");
  } catch (error) {
    throw new Error(errorMessage(error, "Не получилось войти."));
  }
}

export type TwoFactorStatus = { enabled: boolean; method: SecondFactorMethod | null; recoveryLeft: number };

async function twoFactor<T>(body: unknown, fallback: string, read: (data: unknown) => T): Promise<T> {
  try {
    const res = await fetch("/api/auth/2fa", json(body));
    await expectOk(res, fallback);
    return read(res.status === 204 ? null : await res.json().catch(() => null));
  } catch (error) {
    throw new Error(errorMessage(error, fallback));
  }
}

const codesOf = (data: unknown): string[] => {
  const list = (data as { recoveryCodes?: unknown } | null)?.recoveryCodes;
  return Array.isArray(list) ? list.filter((c): c is string => typeof c === "string") : [];
};

/** Включён ли второй шаг у вошедшего и сколько запасных кодов осталось. */
export async function fetchTwoFactorStatus(): Promise<TwoFactorStatus> {
  try {
    const res = await fetch("/api/auth/2fa", { headers: { Accept: "application/json" }, cache: "no-store" });
    await expectOk(res, "Не удалось узнать состояние двухфакторного входа.");
    const data = (await res.json().catch(() => null)) as { enabled?: unknown; method?: unknown; recoveryLeft?: unknown } | null;
    const method: SecondFactorMethod | null = data?.enabled === true ? (data.method === "pin" ? "pin" : "totp") : null;
    return { enabled: data?.enabled === true, method, recoveryLeft: typeof data?.recoveryLeft === "number" ? data.recoveryLeft : 0 };
  } catch (error) {
    throw new Error(errorMessage(error, "Не удалось узнать состояние двухфакторного входа."));
  }
}

/** Шаг 1 включения: секрет и ссылка для приложения. Вход пока не меняется. */
export const startTwoFactor = () =>
  twoFactor({ action: "setup" }, "Не получилось начать настройку.", (data) => {
    const d = data as { secret?: unknown; uri?: unknown } | null;
    if (typeof d?.secret !== "string" || typeof d.uri !== "string") throw new Error("Сервер вернул неполный ответ.");
    return { secret: d.secret, uri: d.uri };
  });

/** Шаг 2: первый код из приложения включает защиту; в ответе запасные коды — показываются один раз. */
export const enableTwoFactor = (code: string) => twoFactor({ action: "enable", code }, "Не получилось включить.", codesOf);

/** Включить PIN из 4 цифр вместо приложения: нужен пароль; в ответе запасные коды — показываются один раз. */
export const enablePin = (pin: string, password: string) => twoFactor({ action: "enable-pin", pin, password }, "Не получилось включить PIN.", codesOf);

/** Выключить: нужны пароль и второй фактор (код приложения, PIN или запасной код). */
export const disableTwoFactor = (password: string, code: string) => twoFactor({ action: "disable", password, code }, "Не получилось выключить.", () => undefined);

/** Новые запасные коды вместо прежних; нужен код из приложения или PIN. */
export const renewRecoveryCodes = (code: string) => twoFactor({ action: "recovery", code }, "Не получилось выпустить коды.", codesOf);

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
}

/** Задать пароль по ссылке-приглашению. */
export async function acceptInvitation(token: string, password: string, name?: string): Promise<void> {
  try {
    await expectOk(await fetch("/api/auth/invitations/accept", json({ token, password, ...(name?.trim() && { name: name.trim() }) })), "Не получилось задать пароль.");
  } catch (error) {
    throw new Error(errorMessage(error, "Не получилось задать пароль."));
  }
}

/** Сменить пароль по ссылке сброса. */
export async function resetPassword(token: string, password: string): Promise<void> {
  try {
    await expectOk(await fetch("/api/auth/password-reset", { ...json({ token, password }), method: "PUT" }), "Не получилось сменить пароль.");
  } catch (error) {
    throw new Error(errorMessage(error, "Не получилось сменить пароль."));
  }
}

/**
 * «Забыли пароль»: просим выслать ссылку на почту. Ответ сервера не говорит, есть ли такой аккаунт; говорит только, настроена ли
 * на сервере отправка писем (mail: false — письмо не уйдёт, человеку нужно сказать об этом прямо).
 */
export async function requestPasswordReset(email: string): Promise<{ mail: boolean }> {
  try {
    const res = await fetch("/api/auth/password-reset", json({ email }));
    await expectOk(res, "Не получилось отправить ссылку.");
    const data = (await res.json().catch(() => null)) as { mail?: unknown } | null;
    return { mail: data?.mail === true };
  } catch (error) {
    throw new Error(errorMessage(error, "Не получилось отправить ссылку."));
  }
}

/** Сменить пароль вошедшему: нужен текущий пароль. Остальные входы (другие компьютеры) завершаются. */
export async function changePassword(current: string, next: string): Promise<void> {
  try {
    await expectOk(await fetch("/api/auth/password", { ...json({ current, next }), method: "PUT" }), "Не получилось сменить пароль.");
  } catch (error) {
    throw new Error(errorMessage(error, "Не получилось сменить пароль."));
  }
}
