import "server-only";
import { unzipSync } from "fflate";

// Архив с документами закупки, как его отдаёт площадка: внутри извещение, ТЗ, проект контракта. Раскладываем на файлы,
// дальше каждый читается как обычный. Папки и служебные файлы пропускаем. Площадки кладут приложения в архив внутри архива
// («Приложение №1 — Технические требования.zip» с таблицей товаров, «Приложение №5 — Образцы форм.7z») — такие вложенные архивы
// открываем тоже, на два уровня вглубь. Читаются .zip и .7z; .rar пока нет, об этом говорим прямо.
//
// .7z читает 7-Zip, скомпилированный в WebAssembly (пакет 7z-wasm, внутри процесса, ничего не ставится в систему; лицензия LGPL).
export const MAX_ZIP_ENTRIES = 40;
const MAX_UNPACKED = 120 * 1024 * 1024;
const MAX_NESTING = 2;
// Архив из тысяч мелких файлов — не документы закупки: не открываем, чтобы не тратить память.
const MAX_ARCHIVE_FILES = 500;

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
type Budget = { total: number };
type Opened = { entries: [string, Uint8Array][] } | { error: string };

function openZip(data: Uint8Array, budget: Budget): Opened {
  try {
    const entries = unzipSync(data, {
      filter: (entry) => {
        if (entry.name.endsWith("/")) return false;
        budget.total += entry.originalSize;
        if (budget.total > MAX_UNPACKED) throw new Error("size");
        return true;
      },
    });
    return { entries: Object.entries(entries) };
  } catch (e) {
    return { error: (e as Error).message === "size" ? "архив слишком большой после распаковки" : "архив повреждён или защищён паролем" };
  }
}

// Пароль заведомо неверный: у зашифрованного архива 7-Zip тогда отвечает «неверный пароль», а не ждёт ввода с клавиатуры сервера.
const NO_PASSWORD = "-pwrong-password-on-purpose";

async function openSevenZip(data: Uint8Array, budget: Budget): Promise<Opened> {
  const { default: SevenZip } = await import("7z-wasm");
  const log: string[] = [];
  // stdin пустой: ни при каких условиях 7-Zip не должен ждать ввода.
  const sz = await SevenZip({ print: (s) => log.push(s), printErr: (s) => log.push(s), stdin: (() => null) as unknown as () => number });
  const run = (args: string[]): boolean => {
    try {
      // В типах пакета callMain ничего не возвращает, на деле возвращает код выхода 7-Zip: 0 — всё хорошо, 2 — ошибка.
      return (sz.callMain(args) as unknown as number) === 0;
    } catch {
      return false;
    }
  };
  sz.FS.writeFile("/in.7z", data);

  // Сначала список без распаковки: сколько файлов и сколько места они займут (маленький архив бывает на сотни мегабайт).
  if (!run(["l", "-slt", "/in.7z", NO_PASSWORD])) return { error: "архив повреждён или защищён паролем" };
  const listing = log.join("\n");
  const files = (listing.match(/^Path = /gm)?.length ?? 1) - 1;
  if (files > MAX_ARCHIVE_FILES) return { error: `в архиве больше ${MAX_ARCHIVE_FILES} файлов — это не документы закупки` };
  for (const m of listing.matchAll(/^Size = (\d+)$/gm)) {
    budget.total += Number(m[1]);
    if (budget.total > MAX_UNPACKED) return { error: "архив слишком большой после распаковки" };
  }

  if (!run(["x", "/in.7z", "-o/out", "-y", NO_PASSWORD])) return { error: "архив повреждён или защищён паролем" };
  const entries: [string, Uint8Array][] = [];
  const walk = (dir: string) => {
    for (const name of sz.FS.readdir(dir)) {
      if (name === "." || name === "..") continue;
      const path = `${dir}/${name}`;
      const { mode } = sz.FS.stat(path);
      if (sz.FS.isDir(mode)) walk(path);
      else if (sz.FS.isFile(mode)) entries.push([path, sz.FS.readFile(path)]);
    }
  };
  walk("/out");
  return { entries };
}

const kindOf = (name: string): "zip" | "7z" | "rar" | null => (/\.zip$/i.test(name) ? "zip" : /\.7z$/i.test(name) ? "7z" : /\.rar$/i.test(name) ? "rar" : null);

// Распаковывает один архив в общий список files; возвращает текст ошибки, если сам архив не открылся. Лимит размера и число файлов — общие для всех уровней.
async function unpackInto(data: Uint8Array, kind: "zip" | "7z", depth: number, budget: Budget, files: File[], skipped: Skipped[]): Promise<string | null> {
  const opened = kind === "7z" ? await openSevenZip(data, budget) : openZip(data, budget);
  if ("error" in opened) return opened.error;

  for (const [rawName, bytes] of opened.entries) {
    const name = fixName(rawName).split("/").pop() ?? "";
    if (!name || name.startsWith(".") || name.startsWith("~$") || bytes.length === 0) continue;
    const nested = kindOf(name);
    if (nested === "zip" || nested === "7z") {
      if (depth + 1 >= MAX_NESTING) {
        skipped.push({ name, reason: "вложенный архив глубже двух уровней — распакуйте его и загрузите файлы отдельно" });
        continue;
      }
      const error = await unpackInto(bytes, nested, depth + 1, budget, files, skipped);
      if (error) skipped.push({ name, reason: `вложенный архив: ${error}` });
      continue;
    }
    if (nested === "rar") {
      skipped.push({ name, reason: "формат .rar пока не читается — распакуйте архив и загрузите файлы отдельно" });
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

/** Раскладывает архив (.zip или .7z — по имени файла) на файлы, вложенные архивы — тоже. */
export async function unzipFiles(data: Uint8Array, archiveName = "архив.zip"): Promise<ZipResult> {
  const kind = kindOf(archiveName) === "7z" ? "7z" : "zip";
  const files: File[] = [];
  const skipped: Skipped[] = [];
  const error = await unpackInto(data, kind, 0, { total: 0 }, files, skipped);
  return error ? { error } : { files, skipped };
}
