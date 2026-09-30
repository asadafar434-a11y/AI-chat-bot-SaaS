import "server-only";
import { unzipSync } from "fflate";

// Архив с документами закупки, как его отдаёт площадка: внутри извещение, ТЗ, проект контракта. Раскладываем на файлы,
// дальше каждый читается как обычный. Вложенные архивы, папки и служебные файлы пропускаем.
export const MAX_ZIP_ENTRIES = 40;
const MAX_UNPACKED = 120 * 1024 * 1024;

// Имена в старых архивах — в кодировке DOS (CP866): без пометки UTF-8 читаются как «ÐÐ·Ð²ÐµÑ‰ÐµÐ½Ð¸Ðµ».
function fixName(raw: string): string {
  if (!/[\u0080-\u00ff]/.test(raw) || /[Ѐ-ӿ]/.test(raw)) return raw;
  const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0) & 0xff);
  try {
    const dos = new TextDecoder("ibm866").decode(bytes);
    return /[А-Яа-яЁё]/.test(dos) ? dos : raw;
  } catch {
    return raw;
  }
}

export type ZipResult = { files: File[]; skipped: { name: string; reason: string }[] } | { error: string };

export function unzipFiles(data: Uint8Array): ZipResult {
  let entries: Record<string, Uint8Array>;
  try {
    let total = 0;
    entries = unzipSync(data, {
      filter: (entry) => {
        if (entry.name.endsWith("/")) return false;
        total += entry.originalSize;
        if (total > MAX_UNPACKED) throw new Error("size");
        return true;
      },
    });
  } catch (e) {
    return { error: (e as Error).message === "size" ? "архив слишком большой после распаковки" : "архив повреждён или защищён паролем" };
  }

  const files: File[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const [rawName, bytes] of Object.entries(entries)) {
    const name = fixName(rawName).split("/").pop() ?? "";
    if (!name || name.startsWith(".") || name.startsWith("~$") || bytes.length === 0) continue;
    if (/\.zip$/i.test(name)) {
      skipped.push({ name, reason: "вложенный архив — распакуйте его и загрузите файлы отдельно" });
      continue;
    }
    if (files.length >= MAX_ZIP_ENTRIES) {
      skipped.push({ name, reason: `в архиве больше ${MAX_ZIP_ENTRIES} файлов — остальные не читаю` });
      continue;
    }
    files.push(new File([bytes as BlobPart], name));
  }
  return { files, skipped };
}
