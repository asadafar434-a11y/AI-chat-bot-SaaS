import type { FailedFile, SentDocument } from "@/lib/read-documents";

// Загруженное в закупку: документы, которые прочитались, и файлы, которые нет. Файлы добавляют по несколько раз — каждая
// добавка складывается с тем, что уже есть. Модуль без зависимостей от браузера: его проверяют тесты (npm test).
export type Upload = { documents: SentDocument[]; failed: FailedFile[] };

// Добавили ещё файлы. Файл с тем же именем — новая версия: она заменяет прежнюю, а не теряется молча. Что не прочиталось
// раньше, не забывается, пока этот файл не прочитают: иначе «файл не прочитан, что в нём требуется — неизвестно» пропало бы
// из заявки после следующей добавки, а заказчик мог потребовать в нём важное.
export function mergeUpload(current: Upload, batch: Upload): Upload {
  const read = new Set(batch.documents.map((d) => d.name));
  const failedNow = new Set(batch.failed.map((f) => f.name));
  return {
    documents: [...current.documents.filter((d) => !read.has(d.name)), ...batch.documents],
    failed: [...current.failed.filter((f) => !read.has(f.name) && !failedNow.has(f.name)), ...batch.failed],
  };
}
