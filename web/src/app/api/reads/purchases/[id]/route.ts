import { AuthError } from "@/server/auth/errors";
import { getDb } from "@/server/db/client";
import { DuplicateLegacyIdError, getPurchase } from "@/server/read/services";
import { readJson, requireReadScope } from "@/server/read/route";

export const dynamic = "force-dynamic";

/** Одна закупка по legacyId (совместимо с `/p/[id]`) либо по id строки. Чужая — 404. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireReadScope(request);
  if (access instanceof Response) {
    return access;
  }
  const { id } = await context.params;
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    return new Response("Некорректный id", { status: 400 });
  }
  try {
    const purchase = await getPurchase({ db: getDb(), scope: access.scope, userId: access.userId }, id);
    if (!purchase) {
      return new Response("Не найдено", { status: 404 });
    }
    return readJson(purchase);
  } catch (error) {
    if (error instanceof DuplicateLegacyIdError) {
      return new Response("Конфликт данных", { status: 409 });
    }
    if (error instanceof AuthError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}
