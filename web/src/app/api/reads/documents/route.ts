import { getDb } from "@/server/db/client";
import { getPurchase, listDocuments } from "@/server/read/services";
import { readJson, requireReadScope } from "@/server/read/route";

export const dynamic = "force-dynamic";

/** Метаданные документов закупки (без текстов — этап S6). `purchaseId` — только ключ выборки в своей организации. */
export async function GET(request: Request) {
  const access = await requireReadScope(request);
  if (access instanceof Response) {
    return access;
  }
  const purchaseId = new URL(request.url).searchParams.get("purchaseId") ?? "";
  if (purchaseId.length === 0 || purchaseId.length > 200) {
    return new Response("Некорректный purchaseId", { status: 400 });
  }
  const ctx = { db: getDb(), scope: access.scope, userId: access.userId, storage: access.storage };
  const purchase = await getPurchase(ctx, purchaseId);
  if (!purchase) {
    return new Response("Не найдено", { status: 404 });
  }
  return readJson(await listDocuments(ctx, purchaseId));
}
