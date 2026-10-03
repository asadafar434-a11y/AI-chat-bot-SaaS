import { grantDocumentDownload } from "@/server/storage/files";
import { fileError } from "@/app/api/storage/documents/route";
import { fileJson, requireFileScope } from "@/server/storage/route";

export const dynamic = "force-dynamic";

/**
 * Выдача подписанной ссылки: только по id документа из своей организации.
 * Знание storageKey ссылку не даёт — ключ из запроса не принимается вообще.
 * Чужая и отсутствующая записи отвечают одинаково (404).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireFileScope();
  if (access instanceof Response) {
    return access;
  }
  try {
    const { id } = await context.params;
    const grant = await grantDocumentDownload(access.ctx, id);
    return fileJson({ ok: true, url: grant.url, expiresIn: grant.expiresIn });
  } catch (error) {
    return fileError(error);
  }
}
