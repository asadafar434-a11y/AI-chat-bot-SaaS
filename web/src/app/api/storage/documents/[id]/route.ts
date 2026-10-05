import { deleteDocument } from "@/server/storage/files";
import { fileError } from "@/app/api/storage/documents/route";
import { fileJson, requireFileScope } from "@/server/storage/route";

export const dynamic = "force-dynamic";

/**
 * Удаление: сначала объект, затем строка. Объект уже отсутствует — строка всё
 * равно удаляется с явным `objectDeleted: false`. Повтор — 404.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireFileScope();
  if (access instanceof Response) {
    return access;
  }
  try {
    const { id } = await context.params;
    const result = await deleteDocument(access.ctx, id);
    return fileJson(result);
  } catch (error) {
    return fileError(error);
  }
}
