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

export async function loginWithPassword(email: string, password: string): Promise<void> {
  try {
    await expectOk(await fetch("/api/auth/login", json({ email, password })), "Не получилось войти.");
  } catch (error) {
    throw new Error(errorMessage(error, "Не получилось войти."));
  }
}

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
