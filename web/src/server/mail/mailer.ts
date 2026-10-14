/**
 * Отправка писем по SMTP — для ссылки «забыли пароль».
 *
 * Работает с любой почтой, у которой есть SMTP: Яндекс 360, Mail.ru для бизнеса, почта хостинга, Gmail
 * (пароль приложения). Привязки к одному провайдеру нет — всё задаётся переменными окружения:
 *
 *   MAIL_SMTP_HOST      — адрес SMTP-сервера (нет значения — письма не отправляются)
 *   MAIL_SMTP_PORT      — порт; по умолчанию 465
 *   MAIL_SMTP_SECURE    — 1 или 0; по умолчанию 1 для порта 465 (шифрование сразу), иначе 0 (шифрование через STARTTLS)
 *   MAIL_SMTP_USER      — логин (обычно сама почта-отправитель)
 *   MAIL_SMTP_PASSWORD  — пароль почты или пароль приложения
 *   MAIL_FROM           — от кого письмо; по умолчанию — логин
 *
 * Если логин задан, пароль в открытом виде не отправляется: соединение должно быть зашифрованным.
 */

import nodemailer from "nodemailer";

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string;
};

export type Mail = { to: string; subject: string; text: string };

/** Всё, что нужно остальному коду от почты: в тестах подменяется. */
export type Mailer = { send(mail: Mail): Promise<void> };

type Env = Record<string, string | undefined>;

/** null — почта не настроена (или настроена неполно): письма не отправляются, остальное работает. */
export function mailConfigFromEnv(env: Env = process.env): MailConfig | null {
  const host = env.MAIL_SMTP_HOST?.trim();
  if (!host) return null;

  const port = Number(env.MAIL_SMTP_PORT?.trim() || 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  const secureRaw = env.MAIL_SMTP_SECURE?.trim().toLowerCase();
  const secure = secureRaw ? secureRaw === "1" || secureRaw === "true" : port === 465;

  const user = env.MAIL_SMTP_USER?.trim() || null;
  const password = env.MAIL_SMTP_PASSWORD || null;
  if (Boolean(user) !== Boolean(password)) return null; // логин без пароля (или наоборот) — настройка не закончена

  const from = env.MAIL_FROM?.trim() || user;
  if (!from) return null;
  return { host, port, secure, user, password, from };
}

export function createSmtpMailer(config: MailConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // С паролем — только по шифрованному соединению (на портах вроде 587 шифрование включается командой STARTTLS).
    requireTLS: !config.secure && Boolean(config.user),
    auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: config.from, to: mail.to, subject: mail.subject, text: mail.text });
    },
  };
}

let cached: { key: string; mailer: Mailer } | null = null;

/** Почтальон по настройкам из окружения; null — почта не настроена. */
export function mailerFromEnv(env: Env = process.env): Mailer | null {
  const config = mailConfigFromEnv(env);
  if (!config) return null;
  const key = JSON.stringify(config);
  if (cached?.key !== key) cached = { key, mailer: createSmtpMailer(config) };
  return cached.mailer;
}
