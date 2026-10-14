// Вход на экране: ссылка-приглашение, проверка «кто вошёл», вход, пароль по ссылке — запросы подменены, сервер не нужен — npm test.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { acceptInvitation, authRouteOf, fetchSession, loginWithPassword, logout, requestPasswordReset, resetPassword } from "./auth-client.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: string; init: RequestInit | undefined };
const stub = (respond: (call: Call) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return calls;
};
const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const TOKEN = "aB3-_xYz0123456789abcdefghijklmnopqrstuvwx";

test("ссылка от владельца: #/invite/… задать пароль, #/reset/… сменить; всё остальное — не ссылка входа", () => {
  assert.deepEqual(authRouteOf(`#/invite/${TOKEN}`), { kind: "invite", token: TOKEN });
  assert.deepEqual(authRouteOf(`#reset/${TOKEN}`), { kind: "reset", token: TOKEN });
  assert.equal(authRouteOf("#/p/abc/package"), null);
  assert.equal(authRouteOf("#/invite/"), null);
  assert.equal(authRouteOf("#/invite/коротко"), null, "токен нужного вида: латиница, цифры, - и _");
  assert.equal(authRouteOf(`#/invite/${TOKEN}<script>`), null);
  assert.equal(authRouteOf(""), null);
});

test("кто вошёл: пользователь из ответа; пустой ответ — никто; ошибка сервера — ошибка, а не «не вошли»", async () => {
  stub(() => Response.json({ user: { id: "u1", email: "o@example.com", name: null }, expires: "2026-11-01" }));
  assert.deepEqual(await fetchSession(), { id: "u1", email: "o@example.com", name: null });
  stub(() => Response.json(null));
  assert.equal(await fetchSession(), null);
  stub(() => Response.json({}));
  assert.equal(await fetchSession(), null);
  stub(() => Response.json({ user: { email: "без-id@example.com" } }));
  assert.equal(await fetchSession(), null, "без идентификатора пользователь не считается вошедшим");
  stub(() => text("", 503));
  await assert.rejects(fetchSession(), /временно недоступен/);
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  await assert.rejects(fetchSession(), TypeError);
});

test("вход: почта и пароль уходят на /api/auth/login; ответ сервера об ошибке показывается как есть", async () => {
  const calls = stub(() => new Response(null, { status: 204 }));
  await loginWithPassword("o@example.com", "пароль-для-теста");
  assert.equal(calls[0].url, "/api/auth/login");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { email: "o@example.com", password: "пароль-для-теста" });

  stub(() => text("Неверный email или пароль", 401));
  await assert.rejects(loginWithPassword("o@example.com", "x"), /Неверный email или пароль/);
  stub(() => text("Слишком много попыток входа — попробуйте через 5 минут.", 429));
  await assert.rejects(loginWithPassword("o@example.com", "x"), /Слишком много попыток/);
  stub(() => new Response("<html><body>502 Bad Gateway</body></html>", { status: 502, headers: { "Content-Type": "text/html" } }));
  await assert.rejects(loginWithPassword("o@example.com", "x"), /временно не отвечает/, "страница ошибки хостинга не показывается как есть");
});

test("пароль по ссылке: приглашение — POST с токеном, паролем и именем; сброс — PUT; пустое имя не уходит", async () => {
  let calls = stub(() => Response.json({ ok: true }));
  await acceptInvitation(TOKEN, "пароль-для-теста", "  Иван  ");
  assert.equal(calls[0].url, "/api/auth/invitations/accept");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { token: TOKEN, password: "пароль-для-теста", name: "Иван" });
  await acceptInvitation(TOKEN, "пароль-для-теста", "   ");
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { token: TOKEN, password: "пароль-для-теста" });

  calls = stub(() => Response.json({ ok: true }));
  await resetPassword(TOKEN, "новый-пароль-теста");
  assert.equal(calls[0].url, "/api/auth/password-reset");
  assert.equal(calls[0].init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { token: TOKEN, password: "новый-пароль-теста" });

  stub(() => text("приглашение недействительно", 400));
  await assert.rejects(acceptInvitation(TOKEN, "пароль-для-теста"), /приглашение недействительно/);
});

test("выход: запрос уходит; сбой сети выход не ломает", async () => {
  const calls = stub(() => new Response(null, { status: 204 }));
  await logout();
  assert.equal(calls[0].url, "/api/auth/logout");
  assert.equal(calls[0].init?.method, "POST");
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  await logout();
});

test("смена пароля: PUT /api/auth/password с текущим и новым; служебная приставка ошибки человеку не показывается", async () => {
  const { changePassword } = await import("./auth-client.ts");
  const calls = stub(() => new Response(null, { status: 204 }));
  await changePassword("старый-пароль-теста", "новый-пароль-теста");
  assert.equal(calls[0].url, "/api/auth/password");
  assert.equal(calls[0].init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { current: "старый-пароль-теста", next: "новый-пароль-теста" });

  stub(() => text("AuthError(invalid_argument): Текущий пароль указан неверно.", 400));
  await assert.rejects(changePassword("x", "y"), (error: Error) => error.message === "Текущий пароль указан неверно.");
  stub(() => text("Нужно войти.", 401));
  await assert.rejects(changePassword("x", "y"), /Нужно войти\./);
  // Приставка убирается и в остальных экранах входа.
  stub(() => text("AuthError(invalid_invitation): приглашение недействительно", 400));
  await assert.rejects(acceptInvitation(TOKEN, "пароль-для-теста"), (error: Error) => error.message === "приглашение недействительно");
});

test("«забыли пароль»: почта уходит POST-запросом, ответ говорит только, отправляются ли письма; ошибки сервера — человеческим текстом", async () => {
  const calls = stub(() => Response.json({ ok: true, mail: true }, { status: 202 }));
  assert.deepEqual(await requestPasswordReset("o@example.com"), { mail: true });
  assert.equal(calls[0].url, "/api/auth/password-reset");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { email: "o@example.com" });

  stub(() => Response.json({ ok: true, mail: false }, { status: 202 }));
  assert.deepEqual(await requestPasswordReset("o@example.com"), { mail: false }, "почта не настроена — об этом нужно сказать человеку");
  stub(() => Response.json({ ok: true }, { status: 202 }));
  assert.deepEqual(await requestPasswordReset("o@example.com"), { mail: false }, "нет явного «да» — считаем, что письма не уйдут");

  stub(() => text("Слишком много запросов — попробуйте через 7 мин.", 429));
  await assert.rejects(requestPasswordReset("o@example.com"), /Слишком много запросов/);
});
