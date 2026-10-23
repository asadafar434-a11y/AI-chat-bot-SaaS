import "server-only";
import { unzipSync } from "fflate";

// Архив с документами закупки, как его отдаёт площадка: внутри извещение, ТЗ, проект контракта. Раскладываем на файлы,
// дальше каждый читается как обычный. Папки и служебные файлы пропускаем. Площадки кладут приложения в архив внутри архива
// («Приложение №1 — Технические требования.zip» с таблицей товаров) — такие вложенные архивы открываем тоже, на два уровня вглубь;
// формат .7z и .rar пока не читается, об этом говорим прямо.
export const MAX_ZIP_ENTRIES = 40;
const MAX_UNPACKED = 120 * 1024 * 1024;
const MAX_NESTING = 2;

// Имена в старых архивах — в кодировке DOS (CP866): без пометки UTF-8 читаются как «ÐÐ·Ð²ÐµÑ‰ÐµÐ½Ð¸Ðµ».
function fixName(raw: string): string {
  if (!/[\u0080-ÿ]/.test(raw) || /[Ѐ-ӿ]/.test(raw)) return raw;
  const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0) & 0xff);
  try {
    const dos = new TextDecoder("ibm866").decode(bytes);
    return /[А-Яа-яЁё]/.test(dos) ? dos : raw;
  } catch {
    return raw;
  }
}

export type ZipResult = { files: File[]; skipped: { name: string; reason: string }[] } | { error: string };

type Skipped = { name: string; reason: string };

// Распаковывает один архив в общий список files; возвращает текст ошибки, если сам архив не открылся. Лимит размера и число файлов — общие для всех уровней.
function unzipInto(data: Uint8Array, depth: number, budget: { total: number }, files: File[], skipped: Skipped[]): string | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter: (entry) => {
        if (entry.name.endsWith("/")) return false;
        budget.total += entry.originalSize;
        if (budget.total > MAX_UNPACKED) throw new Error("size");
        return true;
      },
    });
  } catch (e) {
    return (e as Error).message === "size" ? "архив слишком большой после распаковки" : "архив повреждён или защищён паролем";
  }

  for (const [rawName, bytes] of Object.entries(entries)) {
    const name = fixName(rawName).split("/").pop() ?? "";
    if (!name || name.startsWith(".") || name.startsWith("~$") || bytes.length === 0) continue;
    if (/\.zip$/i.test(name)) {
      if (depth + 1 >= MAX_NESTING) {
        skipped.push({ name, reason: "вложенный архив глубже двух уровней — распакуйте его и загрузите файлы отдельно" });
        continue;
      }
      const error = unzipInto(bytes, depth + 1, budget, files, skipped);
      if (error) skipped.push({ name, reason: `вложенный архив: ${error}` });
      continue;
    }
    if (/\.(7z|rar)$/i.test(name)) {
      skipped.push({ name, reason: `формат .${name.split(".").pop()!.toLowerCase()} пока не читается — распакуйте архив и загрузите файлы отдельно` });
      continue;
    }
    if (files.length >= MAX_ZIP_ENTRIES) {
      skipped.push({ name, reason: `в архиве больше ${MAX_ZIP_ENTRIES} файлов — остальные не читаю` });
      continue;
    }
    files.push(new File([bytes as BlobPart], name));
  }
  return null;
}

export function unzipFiles(data: Uint8Array): ZipResult {
  const files: File[] = [];
  const skipped: Skipped[] = [];
  const error = unzipInto(data, 0, { total: 0 }, files, skipped);
  return error ? { error } : { files, skipped };
}
