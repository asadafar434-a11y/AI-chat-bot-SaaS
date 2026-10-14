// Первый владелец: npm run owner:create -- --email=почта --org="Название компании"
//
// Создаёт организацию, пользователя без пароля и одноразовую ссылку. Ссылку открывает сам человек в браузере и сам задаёт пароль:
// пароль нигде не печатается и не передаётся. Повторный запуск для той же почты выдаёт новую ссылку (задать пароль, если его ещё нет;
// сменить пароль, если уже есть) и не создаёт вторую организацию.
//
// Нужна DATABASE_URL (берётся из web/.env.local) и запущенная база. Платных запросов здесь нет.

import { createOwner } from "../src/server/auth/bootstrap.ts";
import { AuthError } from "../src/server/auth/errors.ts";
import { disconnectPrisma, getTransactionRunner } from "../src/server/db/client.ts";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [key, ...rest] = a.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);

async function main() {
  const email = args.get("email");
  const organization = args.get("org");
  if (!email || !organization) {
    throw new AuthError("invalid_argument", 'укажите почту и название компании: --email=почта --org="Название компании"');
  }
  if (!process.env.DATABASE_URL) {
    throw new AuthError("invalid_argument", "нужна DATABASE_URL (запустите Docker с базой; адрес базы лежит в web/.env.local)");
  }

  const result = await createOwner(getTransactionRunner(), { email, organizationName: organization });
  const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const link = `${base}/#/${result.link.kind === "invite" ? "invite" : "reset"}/${result.link.token}`;
  const until = result.link.expiresAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });

  console.log(result.organizationCreated ? `Создана организация «${organization}».` : "Организация уже есть — новая не создавалась.");
  console.log(result.userCreated ? `Создан владелец ${result.email}.` : `Владелец ${result.email} уже есть.`);
  console.log(result.link.kind === "invite" ? "\nОткройте ссылку в браузере и задайте пароль (ссылка одноразовая):" : "\nПароль у этого владельца уже есть. Ссылка, чтобы задать новый (одноразовая):");
  console.log(`\n${link}\n`);
  console.log(`Действует до ${until} (МСК). Пароль в этой команде нигде не вводится и не печатается.`);
}

main()
  .catch((error) => {
    console.error(error instanceof AuthError ? `Ошибка: ${error.message}` : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
