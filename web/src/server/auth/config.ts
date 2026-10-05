/**
 * Конфигурация Auth.js v5 (NextAuth) в режиме серверных сессий в БД.
 *
 * Провайдеры пусты сознательно: вход реализован собственным обработчиком
 * (`/api/login`), потому что встроенный Credentials-провайдер Auth.js несовместим с
 * database-стратегией (он всегда выдаёт JWT). `PrismaAdapter` нужен для чтения сессий
 * по `sessionToken` и для будущих provider-ов, поэтому он подключается сразу, а
 * `providers: []` не создаёт ни одного обходного пути входа.
 *
 * Файл — единственное место, где Auth.js связывается с Prisma. Доменную логику он не
 * содержит: она живёт в соседних модулях и не зависят от `next-auth`.
 */

import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";

import { getPrismaClient } from "../db/client.ts";
import { withRevokedSessionsForDeletedUsers } from "./adapter.ts";
import { SESSION_MAX_AGE_SECONDS } from "./session.ts";

type SessionUserLike = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Сессии мягко удалённых пользователей недействительны: обёртка возвращает `null`
  // для любой сессии, чей пользователь имеет `deletedAt`, и подчищает её строку.
  adapter: withRevokedSessionsForDeletedUsers(PrismaAdapter(getPrismaClient())),
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS },
  providers: [],
  callbacks: {
    async session({ session, user }) {
      const account = user as SessionUserLike | undefined;
      if (!account?.id) {
        return session;
      }
      // В клиентскую сессию не попадают `sessionToken` и `passwordHash`: только
      // идентификаторы, которые не дают доступа сами по себе.
      const dbSession = session as unknown as { id?: string };
      return {
        user: {
          id: account.id,
          email: account.email ?? null,
          name: account.name ?? null,
          image: account.image ?? null,
        },
        expires: session.expires,
        sessionId: dbSession.id,
      } as unknown as typeof session;
    },
  },
});
