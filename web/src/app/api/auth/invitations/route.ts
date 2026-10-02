import { NextResponse } from "next/server";

import { AuthError } from "@/server/auth/errors";
import { requireOwner } from "@/server/auth/guards";
import { createInvitation } from "@/server/auth/invitation";
import { isSameOrigin } from "@/server/auth/request";
import { getDb } from "@/server/db/client";
import { orgScope } from "@/server/db/org-scope";

/**
 * Создание приглашения owner-ом организации.
 *
 * `organizationId` из тела — только ключ выбора организации; право проверяется на сервере
 * (`requireOwner`), поэтому подмена значения даёт 403, а не доступ к чужой организации.
 *
 * Сырой токен возвращается клиенту только при `AUTH_EXPOSE_TOKENS=1`: отправка письма
 * появится на этапе S8 (pg-boss), и до неё токен нужно как-то доставить. В продакшене
 * флаг выключен, и токен не покидает сервер через ответ.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response("Недопустимый источник запроса", { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => null)) as
      | { organizationId?: unknown; email?: unknown; role?: unknown }
      | null;
    const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
    if (!organizationId) {
      return new Response("Не указана организация", { status: 400 });
    }

    const db = getDb();
    const session = await requireOwner(organizationId, db);
    const result = await createInvitation(db, orgScope(organizationId), {
      email: body?.email,
      role: body?.role === "owner" ? "owner" : "member",
      invitedByUserId: session.userId,
    });

    return NextResponse.json(
      {
        id: result.invitation.id,
        email: result.invitation.email,
        role: result.invitation.role,
        expiresAt: result.expiresAt,
        ...(process.env.AUTH_EXPOSE_TOKENS === "1" ? { token: result.token } : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}
