/**
 * Запрос ссылки «забыли пароль»: выдаём одноразовый токен и шлём письмо со ссылкой.
 *
 * Ответ человеку не зависит от того, есть ли такой аккаунт: письмо уходит только существующему,
 * но об этом снаружи не узнать (отправка не ждёт ответа почтового сервера). Единственное, что
 * известно заранее и одинаково для всех, — настроена ли на сервере почта.
 */

import type { Mail, Mailer } from "../mail/mailer.ts";
import type { DbClient } from "../db/db-client.ts";
import { tryNormalizeEmail } from "./email.ts";
import { createPasswordResetToken } from "./password-reset.ts";
import { PASSWORD_RESET_TTL_MS } from "./tokens.ts";

export type ResetRequestResult = {
  /** Настроена ли отправка писем на этом сервере. */
  mail: boolean;
  /** Токен — только для отладки (AUTH_EXPOSE_TOKENS); в ответ человеку не попадает. */
  token: string | null;
  /** Завершается, когда отправка закончилась (удачно или нет); никогда не отклоняется. Обработчик её не ждёт, тесты — ждут. */
  delivery: Promise<void>;
};

/** Ссылка, по которой экран продукта открывает «Новый пароль» (адрес после # разбирает `authRouteOf`). */
export function resetLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/#/reset/${token}`;
}

export function resetMail(to: string, link: string, ttlMs = PASSWORD_RESET_TTL_MS): Mail {
  const minutes = Math.round(ttlMs / 60_000);
  const valid = minutes % 60 === 0 ? (minutes === 60 ? "1 час" : `${minutes / 60} ч`) : `${minutes} мин`;
  return {
    to,
    subject: "Тендерный юрист — новый пароль",
    text: [
      "Здравствуйте!",
      "",
      "Для входа в «Тендерный юрист» запросили новый пароль. Чтобы задать его, откройте ссылку:",
      "",
      link,
      "",
      `Ссылка действует ${valid} и работает один раз. После смены пароля нужно будет войти заново.`,
      "",
      "Если вы ничего не просили — просто удалите это письмо: пароль останется прежним.",
    ].join("\n"),
  };
}

export async function requestPasswordReset(
  deps: { db: DbClient; mailer: Mailer | null; baseUrl: string | null; log?: (message: string) => void },
  email: unknown,
): Promise<ResetRequestResult> {
  const issued = await createPasswordResetToken(deps.db, email);
  const token = issued?.token ?? null;
  // Без адреса сайта ссылку составить нельзя — это та же «почта не настроена».
  const mailer = deps.baseUrl ? deps.mailer : null;
  if (!mailer || !deps.baseUrl) return { mail: false, token, delivery: Promise.resolve() };

  const to = tryNormalizeEmail(email);
  if (!issued || !to) return { mail: true, token, delivery: Promise.resolve() };

  const delivery = mailer.send(resetMail(to, resetLink(deps.baseUrl, issued.token))).catch((error: unknown) => {
    // В журнал — только причина: ни токена, ни ссылки.
    deps.log?.(`Не удалось отправить письмо со ссылкой сброса: ${error instanceof Error ? error.message : String(error)}`);
  });
  return { mail: true, token, delivery };
}
