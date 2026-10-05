import { replacePurchaseDocuments } from "@/server/write/services";
import { requireWriteScope, writeError, writeJson } from "@/server/write/route";

export const dynamic = "force-dynamic";

/**
 * Замена закупки вместе с документами (parity с `savePurchaseWithDocuments`).
 * Тело: `{ purchase?, documents: [] }`. Атомарно.
 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireWriteScope(request);
  if (access instanceof Response) {
    return access;
  }
  try {
    const body = (await request.json().catch(() => null)) as
      | { purchase?: unknown; documents?: unknown }
      | null;
    const result = await replacePurchaseDocuments(access.ctx, (await context.params).id, {
      purchase: body?.purchase,
      documents: body?.documents,
    });
    return writeJson({ ok: true, ...result });
  } catch (error) {
    return writeError(error);
  }
}
