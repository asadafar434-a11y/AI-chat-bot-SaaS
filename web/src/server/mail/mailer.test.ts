// Почта: настройки из окружения и настоящая отправка по SMTP — в локальный «почтовый сервер» из теста, наружу ничего не уходит.
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import test from "node:test";

import { createSmtpMailer, mailConfigFromEnv, mailerFromEnv } from "./mailer.ts";

test("настройки почты: без адреса сервера почта выключена; порт 465 — шифрование сразу; логин без пароля — настройка не закончена", () => {
  assert.equal(mailConfigFromEnv({}), null);
  assert.equal(mailConfigFromEnv({ MAIL_SMTP_HOST: "  " }), null);
  assert.equal(mailerFromEnv({}), null);

  assert.deepEqual(mailConfigFromEnv({ MAIL_SMTP_HOST: "smtp.example.com", MAIL_SMTP_USER: "robot@example.com", MAIL_SMTP_PASSWORD: "секрет" }), {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    user: "robot@example.com",
    password: "секрет",
    from: "robot@example.com",
  });
  const starttls = mailConfigFromEnv({
    MAIL_SMTP_HOST: "smtp.example.com",
    MAIL_SMTP_PORT: "587",
    MAIL_SMTP_USER: "robot@example.com",
    MAIL_SMTP_PASSWORD: "x",
    MAIL_FROM: "Тендерный юрист <robot@example.com>",
  });
  assert.equal(starttls?.secure, false, "на порту 587 шифрование включается позже, командой STARTTLS");
  assert.equal(starttls?.from, "Тендерный юрист <robot@example.com>");
  assert.equal(mailConfigFromEnv({ MAIL_SMTP_HOST: "h", MAIL_SMTP_PORT: "465", MAIL_SMTP_SECURE: "0", MAIL_SMTP_USER: "u", MAIL_SMTP_PASSWORD: "p" })?.secure, false);

  assert.equal(mailConfigFromEnv({ MAIL_SMTP_HOST: "h", MAIL_SMTP_USER: "u" }), null, "логин без пароля");
  assert.equal(mailConfigFromEnv({ MAIL_SMTP_HOST: "h", MAIL_SMTP_PASSWORD: "p" }), null, "пароль без логина");
  assert.equal(mailConfigFromEnv({ MAIL_SMTP_HOST: "h" }), null, "некому быть отправителем");
  assert.equal(mailConfigFromEnv({ MAIL_SMTP_HOST: "h", MAIL_FROM: "a@example.com", MAIL_SMTP_PORT: "99999" }), null, "порт вне диапазона");
  assert.ok(mailConfigFromEnv({ MAIL_SMTP_HOST: "h", MAIL_FROM: "a@example.com" }), "без логина (внутренний почтовый сервер) — можно");
});

// Письмо приходит в кодировке base64 или quoted-printable — раскодируем, чтобы читать глазами.
function decodeBody(raw: string): string {
  const [head, ...rest] = raw.split("\r\n\r\n");
  const body = rest.join("\r\n\r\n");
  if (/content-transfer-encoding:\s*base64/i.test(head)) return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) {
    const bytes = body.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, "latin1").toString("utf8");
  }
  return body;
}
function decodeSubject(raw: string): string {
  const line = raw.match(/^Subject:\s*(.*(?:\r\n[ \t].*)*)/im)?.[1] ?? "";
  return line
    .replace(/\r\n[ \t]/g, "")
    .replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/gi, (_, b: string) => Buffer.from(b, "base64").toString("utf8"))
    .replace(/=\?UTF-8\?Q\?([^?]*)\?=\s*/gi, (_, q: string) => Buffer.from(q.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (__, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"));
}

test("письмо уходит по SMTP: получатель, отправитель, тема и текст с кириллицей и ссылкой доходят целыми", async () => {
  const received: string[] = [];
  const commands: string[] = [];
  const server = net.createServer((socket) => {
    socket.write("220 test ESMTP\r\n");
    let inData = false;
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (inData) {
        if (buffer.endsWith("\r\n.\r\n")) {
          received.push(buffer.slice(0, -5));
          buffer = "";
          inData = false;
          socket.write("250 queued\r\n");
        }
        return;
      }
      let at: number;
      while ((at = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        commands.push(line);
        if (/^(EHLO|HELO)/i.test(line)) socket.write("250-test\r\n250 8BITMIME\r\n");
        else if (/^(MAIL FROM|RCPT TO)/i.test(line)) socket.write("250 ok\r\n");
        else if (/^DATA/i.test(line)) {
          socket.write("354 go\r\n");
          inData = true;
          break;
        } else if (/^QUIT/i.test(line)) {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("250 ok\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;

  try {
    const mailer = createSmtpMailer({ host: "127.0.0.1", port, secure: false, user: null, password: null, from: "Тендерный юрист <robot@example.com>" });
    await mailer.send({
      to: "owner@example.com",
      subject: "Тендерный юрист — новый пароль",
      text: "Здравствуйте!\n\nhttp://localhost:3000/#/reset/aB3-_xYz0123456789abcdefghijklmnopqrstuvwx\n\nСсылка действует 1 час.",
    });
  } finally {
    server.close();
  }

  assert.ok(commands.some((c) => /^MAIL FROM:\s*<robot@example\.com>/i.test(c)), "отправитель — адрес из «Тендерный юрист <…>»");
  assert.ok(commands.some((c) => /^RCPT TO:\s*<owner@example\.com>/i.test(c)));
  assert.equal(received.length, 1);
  assert.equal(decodeSubject(received[0]), "Тендерный юрист — новый пароль");
  const text = decodeBody(received[0]);
  assert.match(text, /Здравствуйте!/);
  assert.match(text, /http:\/\/localhost:3000\/#\/reset\/aB3-_xYz0123456789abcdefghijklmnopqrstuvwx/);
  assert.match(text, /Ссылка действует 1 час\./);
});

test("сервер почты недоступен — отправка завершается ошибкой, а не зависает", async () => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as net.AddressInfo).port;
  probe.close();
  await once(probe, "close");

  const mailer = createSmtpMailer({ host: "127.0.0.1", port, secure: false, user: null, password: null, from: "robot@example.com" });
  await assert.rejects(mailer.send({ to: "a@example.com", subject: "x", text: "y" }));
});
