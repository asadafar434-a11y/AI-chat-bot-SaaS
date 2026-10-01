import JSZip from "jszip";
import { PART_TITLES, type TpPart } from "@/lib/tp-parts";
import { FILE_FORMATS, formatOf } from "@/lib/file-format";
import { attachment, fileFromRequest, type DocxRequest } from "@/lib/tp-docx-request";
import { badRequest, readJson } from "@/lib/read-json";

// Все файлы заявки одним архивом: ТП и остальные части, каждая — отдельным файлом Word, PDF или ODT, по порядку.
// Частей у заявки не больше шести, поэтому больше десяти файлов — это не наша заявка.
const MAX_FILES = 10;

// Название закупки идёт в имя архива: без символов, которые нельзя в имени файла.
const cleanName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return badRequest();
  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) return new Response("Нет файлов для архива.", { status: 400 });
  if (files.length > MAX_FILES) return new Response(`В архиве не больше ${MAX_FILES} файлов.`, { status: 400 });
  // Формат — один на весь архив: Word по умолчанию.
  const format = formatOf(body.format);

  const zip = new JSZip();
  const added = new Set<TpPart>();
  for (const file of files) {
    const made = await fileFromRequest((file ?? {}) as DocxRequest, format);
    if (!made.ok) return new Response(`${made.message}`, { status: made.status });
    if (added.has(made.part)) continue;
    added.add(made.part);
    zip.file(`${added.size}. ${PART_TITLES[made.part]}.${FILE_FORMATS[format].ext}`, made.buffer);
  }
  const archive = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  const name = `${cleanName(String(body.name ?? "")) || "Заявка"}.zip`;
  return new Response(archive, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": attachment(name, "application.zip") },
  });
}
