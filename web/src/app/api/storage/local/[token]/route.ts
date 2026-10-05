/**
 * Раздача файлов fs-бэкенда по подписанной ссылке (только локальная
 * разработка/тесты; в production этот бэкенд запрещён конфигурацией).
 *
 * Без сессии by design: ссылка — bearer-возможность с коротким TTL, её мог
 * выпустить только сервер после полной авторизации (секрет серверный).
 * Проверяются подпись, срок и наличие строки с ключом; имя файла в ответе
 * фиксированное (без инъекций через заголовки).
 */

import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { getDb } from "@/server/db/client";
import { checkLocalToken } from "@/server/storage/fs";

export const dynamic = "force-dynamic";

const denied = () => new Response("Ссылка недействительна", { status: 403 });

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  if (process.env.STORAGE_BACKEND !== "fs") {
    return new Response("Недоступно", { status: 404 });
  }
  const { token } = await context.params;
  const checked = checkLocalToken(process.env.STORAGE_FS_SECRET ?? "", token);
  if (!checked.ok) {
    return denied();
  }
  const db = getDb();
  const row = (await db.document.findFirst({ where: { id: checked.documentId } })) as {
    storageKey: string | null;
    mimeType: string | null;
  } | null;
  if (!row || typeof row.storageKey !== "string" || !row.storageKey) {
    return denied();
  }
  const root = resolve(process.env.STORAGE_FS_DIR ?? "");
  const file = resolve(join(root, ...row.storageKey.split("/")));
  if (file !== root && !file.startsWith(root + sep)) {
    return denied();
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    return denied();
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": row.mimeType ?? "application/octet-stream",
      "Content-Disposition": 'attachment; filename="file"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
