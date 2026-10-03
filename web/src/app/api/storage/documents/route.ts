import { AuthError } from "@/server/auth/errors";
import { InvalidArgumentError, NotFoundInScopeError } from "@/server/db/errors";
import { enqueue } from "@/server/jobs/enqueue";
import { uploadDocument } from "@/server/storage/files";
import { fileJson, requireFileScope } from "@/server/storage/route";
import { StorageError } from "@/server/storage/types";

export const dynamic = "force-dynamic";

/**
 * Загрузка файла: валидация → объект в хранилище → метаданные в PostgreSQL.
 * Тело: `{ purchaseId, fileName, mimeType?, contentBase64, sha256?, ocr? }`.
 * Ключ объекта серверный и наружу не возвращается.
 */
export async function POST(request: Request) {
  const access = await requireFileScope();
  if (access instanceof Response) {
    return access;
  }
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return new Response("Некорректное тело", { status: 400 });
    }
    const result = await uploadDocument(access.ctx, {
      purchaseId: body.purchaseId as string,
      fileName: body.fileName as string,
      mimeType: body.mimeType,
      contentBase64: body.contentBase64,
      sha256: body.sha256,
      ocr: body.ocr,
    });

    // S8: загрузка документа запускает фоновое извлечение текста. Best-effort:
    // сама загрузка от этого не зависит, а забытую задачу подхватит сверка
    // (enqueue — no-op, если JOBS_ENABLED не задан). Окно отказа: документ
    // загружен, задача не поставлена — тогда текст извлечётся повторной загрузкой
    // или операционным sweep.
    try {
      await enqueue("document.extract", {
        documentId: result.id,
        organizationId: access.ctx.scope.organizationId,
        operationVersion: 1,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "jobs.enqueue.failed",
          queue: "document.extract",
          documentId: result.id,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    return fileJson({ ok: true, ...result }, 201);
  } catch (error) {
    return fileError(error);
  }
}

export function fileError(error: unknown): Response {
  if (error instanceof AuthError) {
    return new Response(error.message, { status: error.status });
  }
  if (error instanceof NotFoundInScopeError) {
    return new Response("Не найдено", { status: 404 });
  }
  if (error instanceof InvalidArgumentError) {
    return new Response(error.message, { status: 400 });
  }
  if (error instanceof StorageError) {
    return new Response("Хранилище временно недоступно", { status: 502 });
  }
  throw error;
}
