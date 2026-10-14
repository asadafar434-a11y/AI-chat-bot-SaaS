// «Забыли пароль»: письмо уходит только существующему аккаунту, ответ одинаков для всех, ссылка рабочая, сбой почты не ломает запрос.
import assert from "node:assert/strict";
import test from "node:test";

import type { Mail, Mailer } from "../mail/mailer.ts";
import { resetLink, resetMail, requestPasswordReset } from "./reset-request.ts";
import { authRouteOf } from "../../lib/auth-client.ts";
import { resetPasswordWithToken } from "./password-reset.ts";
import { verifyPassword } from "./password.ts";
import { withRunner } from "./transaction.ts";
import { createMemoryDb } from "./testing/memory-db.ts";

const BASE = "https://tender.example.ru";

function memoryWithUser() {
  return createMemoryDb({ user: [{ id: "u1", email: "owner@example.com", name: null, passwordHash: null, deletedAt: null }] });
}
function fakeMailer(fail = false) {
  const sent: Mail[] = [];
  const mailer: Mailer = {
    async send(mail) {
      if (fail) throw new Error("connect ECONNREFUSED");
      sent.push(mail);
    },
  };
  return { mailer, sent };
}

test("существующему аккаунту уходит письмо со ссылкой, по которой экран открывает «Новый пароль» и пароль меняется", async () => {
  const memory = memoryWithUser();
  const { mailer, sent } = fakeMailer();

  const result = await requestPasswordReset({ db: memory.db, mailer, baseUrl: BASE }, "  Owner@Example.com ");
  await result.delivery;

  assert.equal(result.mail, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "owner@example.com", "почта приводится к одному виду");
  assert.match(sent[0].subject, /пароль/i);
  const link = sent[0].text.match(/https:\/\/\S+/)?.[0] ?? "";
  assert.ok(link.startsWith(`${BASE}/#/reset/`), `ссылка ведёт на экран сброса: ${link}`);

  const route = authRouteOf(new URL(link).hash);
  assert.equal(route?.kind, "reset");
  assert.equal(route?.token, result.token, "токен из письма — тот самый, что выдан");

  await resetPasswordWithToken(withRunner(memory.db), route!.token, "new-secret-pass");
  assert.equal(await verifyPassword("new-secret-pass", memory.table("user")[0].passwordHash as string), true);
});

test("несуществующая или кривая почта: письма нет, ответ тот же — по нему аккаунты не перебрать", async () => {
  const memory = memoryWithUser();
  const { mailer, sent } = fakeMailer();

  const known = await requestPasswordReset({ db: memory.db, mailer, baseUrl: BASE }, "owner@example.com");
  const ghost = await requestPasswordReset({ db: memory.db, mailer, baseUrl: BASE }, "ghost@example.com");
  const broken = await requestPasswordReset({ db: memory.db, mailer, baseUrl: BASE }, "не почта");
  await Promise.all([known.delivery, ghost.delivery, broken.delivery]);

  assert.deepEqual([known.mail, ghost.mail, broken.mail], [true, true, true]);
  assert.equal(ghost.token, null);
  assert.equal(broken.token, null);
  assert.equal(sent.length, 1, "письмо ушло одно — владельцу");
  assert.equal(memory.table("verificationToken").length, 1, "лишних токенов нет");
});

test("почта не настроена или нет адреса сайта: письмо не уходит, ответ честно говорит mail=false", async () => {
  const memory = memoryWithUser();
  const { mailer, sent } = fakeMailer();

  const off = await requestPasswordReset({ db: memory.db, mailer: null, baseUrl: BASE }, "owner@example.com");
  assert.equal(off.mail, false);
  const noBase = await requestPasswordReset({ db: memory.db, mailer, baseUrl: null }, "owner@example.com");
  assert.equal(noBase.mail, false, "без AUTH_URL ссылку составить нельзя — localhost в письме быть не должно");
  assert.equal(sent.length, 0);
});

test("сбой почтового сервера не ломает запрос и не попадает в журнал вместе со ссылкой", async () => {
  const memory = memoryWithUser();
  const { mailer } = fakeMailer(true);
  const log: string[] = [];

  const result = await requestPasswordReset({ db: memory.db, mailer, baseUrl: BASE, log: (m) => log.push(m) }, "owner@example.com");
  await result.delivery; // не отклоняется

  assert.equal(result.mail, true);
  assert.equal(log.length, 1);
  assert.match(log[0], /ECONNREFUSED/);
  assert.ok(!log[0].includes(result.token as string), "токен в журнал не пишется");
});

test("текст письма: ссылка без двойных слэшей, срок действия назван правильно", () => {
  assert.equal(resetLink("https://a.ru/", "TOK"), "https://a.ru/#/reset/TOK");
  assert.match(resetMail("a@b.ru", "L").text, /действует 1 час/);
  assert.match(resetMail("a@b.ru", "L", 30 * 60_000).text, /действует 30 мин/);
  assert.match(resetMail("a@b.ru", "L", 2 * 60 * 60_000).text, /действует 2 ч/);
});
