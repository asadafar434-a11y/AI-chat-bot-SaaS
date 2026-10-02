import { NextResponse } from "next/server";

import { AuthError } from "@/server/auth/errors";
import { acceptInvitation } from "@/server/auth/invitation";
import { isSameOrigin } from "@/server/auth/request";
import { getTransactionRunner } from "@/server/db/client";

/**
 * Принятие приглашения — одноразовый setup-flow (§4 контракта S2).
 *
 * Анонимен по построению: иначе приглашённый не смог бы им воспользоваться.
 * Организация и роль берутся только из строки приглашения — параметра организации
 * у операции нет, поэтому токен не может создать членство в чужой организации.
 * В ответе нет ни сырого токена, ни email: ошибки тоже не раскрывают email
 * и организацию (только существо отказа).
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response("Недопустимый источник запроса", { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => null)) as
      | { token?: unknown; password?: unknown; name?: unknown }
      | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const name = typeof body?.name === "string" ? body.name : undefined;
    const result = await acceptInvitation(getTransactionRunner(), token, {
      password: body?.password,
      ...(name !== undefined ? { name } : {}),
    });
    return NextResponse.json(
      {
        ok: true,
        userId: result.userId,
        organizationId: result.organizationId,
        role: result.role,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}
