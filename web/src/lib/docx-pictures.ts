import { strFromU8, unzipSync } from "fflate";

// Картинки-документы внутри Word: заказчики вставляют таблицу «Обоснование начальной цены» снимком из Excel (29.10.2026, «Братский дом-интернат»: Приложение № 5 — две картинки,
// текста нет). Такую картинку распознаём, как скан; фотографии товаров — нет: они маленькие и стоят в ячейках таблицы описания объекта, а таблица-снимок — большая и вне таблиц.
// Модуль без сети и ИИ: только находит картинки и отдаёт их байты; распознаёт lib/ocr.ts.

export type DocPicture = { data: Uint8Array; mediaType: "image/png" | "image/jpeg"; /** Текст перед картинкой (заголовок приложения) — чтобы было видно, откуда таблица. */ before: string };

/** Не уже 12 см: снимок таблицы или страницы, а не фото товара. */
export const MIN_PICTURE_CM = 12;
/** Больше — не таблица, а альбом: распознавать дорого и незачем. */
export const MAX_PICTURES = 6;
const MAX_PICTURE_BYTES = 5 * 1024 * 1024;
const EMU_PER_CM = 360_000;
const PT_PER_CM = 28.3465;

const plainText = (xml: string) =>
  xml
    .replace(/<w:tab\/>/g, " ")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ");

/** Последние строки текста перед картинкой (заголовок приложения бывает разбит на несколько абзацев), не длиннее 200 знаков. */
function textBefore(xml: string, at: number): string {
  const lines = plainText(xml.slice(Math.max(0, at - 20_000), at))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const tail = lines.slice(-3).join(" ");
  const start = tail.search(/приложение\s*№?\s*\d/i);
  return (start >= 0 ? tail.slice(start) : tail).slice(0, 200);
}

/** Ширина картинки в сантиметрах: у современной вставки — wp:extent (EMU), у старой (VML) — style="width:…pt". */
function widthCm(xml: string, at: number): number {
  const head = xml.slice(Math.max(0, at - 4000), at);
  const extents = [...head.matchAll(/<wp:extent cx="(\d+)"/g)];
  if (extents.length > 0) return Number(extents[extents.length - 1][1]) / EMU_PER_CM;
  const styles = [...head.matchAll(/width:\s*([\d.]+)\s*(pt|in|cm|mm)/g)];
  if (styles.length === 0) return 0;
  const [, n, unit] = styles[styles.length - 1];
  const v = Number(n);
  return unit === "pt" ? v / PT_PER_CM : unit === "in" ? v * 2.54 : unit === "mm" ? v / 10 : v;
}

const MEDIA: Record<string, DocPicture["mediaType"]> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

/** Большие картинки вне таблиц, по порядку в документе; одна и та же картинка (Word пишет её дважды — для новых и старых программ) — один раз. */
export function findDocumentPictures(data: Uint8Array): DocPicture[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => f.name === "word/document.xml" || f.name === "word/_rels/document.xml.rels" || f.name.startsWith("word/media/") });
  } catch {
    return [];
  }
  const xml = files["word/document.xml"] ? strFromU8(files["word/document.xml"]) : "";
  const rels = files["word/_rels/document.xml.rels"] ? strFromU8(files["word/_rels/document.xml.rels"]) : "";
  if (!xml || !rels) return [];
  const targetOf = (id: string) => {
    const m = new RegExp(`<Relationship\\b[^>]*\\bId="${id}"[^>]*>`).exec(rels)?.[0];
    return m ? (/\bTarget="([^"]+)"/.exec(m)?.[1] ?? null) : null;
  };

  const out: DocPicture[] = [];
  const seen = new Set<string>();
  // Глубина ячеек таблицы считается по ходу документа: картинка в ячейке — фото товара в описании объекта.
  const marks = /<w:tc[ >]|<\/w:tc>|<a:blip\b[^>]*\br:embed="(rId\d+)"|<v:imagedata\b[^>]*\br:id="(rId\d+)"/g;
  let depth = 0;
  for (const m of xml.matchAll(marks)) {
    if (m[0].startsWith("<w:tc")) {
      depth++;
      continue;
    }
    if (m[0] === "</w:tc>") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const id = m[1] ?? m[2];
    if (depth > 0 || seen.has(id)) continue;
    seen.add(id);
    if (widthCm(xml, m.index) < MIN_PICTURE_CM) continue;
    const target = targetOf(id);
    if (!target || /^https?:/i.test(target)) continue;
    const path = `word/${target.replace(/^\/?word\//, "").replace(/^\.\//, "")}`;
    const bytes = files[path];
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const mediaType = MEDIA[ext];
    if (!bytes || !mediaType || bytes.length > MAX_PICTURE_BYTES) continue;
    out.push({ data: bytes, mediaType, before: textBefore(xml, m.index) });
    if (out.length >= MAX_PICTURES) break;
  }
  return out;
}
