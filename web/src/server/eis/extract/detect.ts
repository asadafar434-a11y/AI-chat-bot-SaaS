/**
 * EIS Document Intelligence — определение формата по сигнатуре байтов.
 * Расширение имени — только подсказка; решает магия байтов.
 * Повреждённые файлы не роняют detect: возвращается unknown, ошибка фиксируется на этапе extract.
 */

import type { EisDocFormat } from "./types.ts";

const startsWith = (bytes: Uint8Array, prefix: Array<number>): boolean =>
  prefix.every((b, i) => bytes[i] === b);

const asciiPrefix = (bytes: Uint8Array, text: string): boolean => {
  if (bytes.length < text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[i] !== text.charCodeAt(i)) return false;
  }
  return true;
};

export function extensionOf(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Эвристика «похоже на текст»: доля печатных символов и пробелов в префиксе. */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.length === 0) return false;
  let printable = 0;
  for (const b of sample) {
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f) || b >= 0x80) printable++;
  }
  return printable / sample.length > 0.9;
}

export function detectFormat(bytes: Uint8Array, fileName: string): EisDocFormat {
  if (bytes.length >= 5 && asciiPrefix(bytes, "%PDF-")) return "pdf";
  if (bytes.length >= 4 && startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return detectZipFlavor(bytes, fileName);
  if (bytes.length >= 3 && startsWith(bytes, [0xff, 0xd8, 0xff])) return "image";
  if (bytes.length >= 8 && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image";
  if (bytes.length >= 6 && (asciiPrefix(bytes, "GIF87a") || asciiPrefix(bytes, "GIF89a"))) return "image";
  if (bytes.length >= 12 && asciiPrefix(bytes, "RIFF") && asciiPrefix(bytes.subarray(8), "WEBP")) return "image";
  if (bytes.length >= 2 && startsWith(bytes, [0x42, 0x4d])) return "image";
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4096));
  if (/^\s*</.test(text)) return "xml";
  const ext = extensionOf(fileName);
  if (["txt", "md", "csv", "json", "rtf", "log"].includes(ext) || looksLikeText(bytes)) {
    // .xml по расширению без XML-сигнатуры — всё равно разберём как текст: extract решит.
    if (ext === "xml") return "xml";
    return "text";
  }
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  if (ext === "zip") return "zip";
  return "unknown";
}

/**
 * ZIP-контейнер: docx/xlsx отличаются именами частей.
 * Читаем только central directory (без распаковки) — дёшево и безопасно.
 */
function detectZipFlavor(bytes: Uint8Array, fileName: string): EisDocFormat {
  const names = listZipNames(bytes);
  if (names === undefined) {
    // Оглавление не читается: тип — по расширению, чтобы extract дал честный
    // failed-статус соответствующего формата, а не молчаливый unknown.
    const ext = extensionOf(fileName);
    if (ext === "docx") return "docx";
    if (ext === "xlsx") return "xlsx";
    if (ext === "zip") return "zip";
    return "unknown";
  }
  const has = (suffix: string): boolean => names.some((n) => n === suffix || n.endsWith(`/${suffix}`));
  if (has("word/document.xml")) return "docx";
  if (has("xl/workbook.xml")) return "xlsx";
  return "zip";
}

/** Имена записей ZIP по central directory; undefined — архив не разбирается. */
export function listZipNames(bytes: Uint8Array): string[] | undefined {
  try {
    if (bytes.length < 22) return undefined;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return undefined;
    const total = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const names: string[] = [];
    const decoder = new TextDecoder("utf-8");
    for (let i = 0; i < total; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) return undefined;
      const nameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      names.push(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen)));
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return names;
  } catch {
    return undefined;
  }
}
