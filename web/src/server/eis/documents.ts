/**
 * EIS Collector v1 — парсинг ответов СОИ и разбор архивов.
 *
 * Только чистые функции (без I/O) — легко покрываются unit-тестами.
 *
 * UNCONFIRMED: имена XML-тегов (archiveUrl, reestrNumber, purchaseNumber,
 * subsystemType, documentType44, attachment/url/fileName) взяты из стороннего
 * разбора SOAP СОИ (Habr 12.2024), а не из официальной XSD.
 * TODO: сверить каждое имя тега и порядок selectionParams с актуальной
 * официальной схемой getDocsIP-ws-api.xsd (см. README модуля) и зафиксировать
 * результат сверки. Парсеры намеренно толерантны (префиксы неймспейсов,
 * оба варианта номеров), чтобы расхождения давали пустой результат с понятной
 * ошибкой, а не молчаливую неверную выборку.
 */

import { inflateRawSync } from "node:zlib";
import { EisError } from "./errors.ts";
import type { EisDocumentMetadata, EisLaw, EisTenderRef } from "./types.ts";

/** Реестровый номер: только цифры, длина 11..19 (223-ФЗ ~11 цифр, 44-ФЗ 19 цифр). */
export function parseRegistryNumber(raw: string): string {
  const value = raw.trim();
  if (!/^\d{11,19}$/.test(value)) {
    throw new EisError("VALIDATION_ERROR", `Некорректный registry number: ${raw}`);
  }
  return value;
}

export function isRegistryNumber(raw: string): boolean {
  try {
    parseRegistryNumber(raw);
    return true;
  } catch {
    return false;
  }
}

/** Все текстовые значения тега <[prefix:]tag>value</[prefix:]tag> (толерантно к префиксам). */
export function extractTagValues(xml: string, tag: string): string[] {
  const re = new RegExp(`<[^>\\s/]*:?${tag}(?:\\s[^>]*)?>([^<]*)<\\/[^>]*:?${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const value = (m[1] ?? "").trim();
    if (value) out.push(value);
  }
  return out;
}

/** Ссылки на архивы ХД из SOAP-ответа (<dataInfo><archiveUrl>...</archiveUrl></...). */
export function parseArchiveUrls(soapXml: string): string[] {
  const urls = extractTagValues(soapXml, "archiveUrl").map((u) => u.trim()).filter(Boolean);
  return [...new Set(urls)];
}

/**
 * Реестровые номера закупок из ответа (reestrNumber / purchaseNumber).
 * Возвращает уникальные валидные номера в порядке появления.
 */
export function parseRegistryNumbers(soapXml: string, law: EisLaw): EisTenderRef[] {
  const raw = [...extractTagValues(soapXml, "reestrNumber"), ...extractTagValues(soapXml, "purchaseNumber")];
  const seen = new Set<string>();
  const refs: EisTenderRef[] = [];
  for (const candidate of raw) {
    if (!isRegistryNumber(candidate)) continue;
    const registryNumber = parseRegistryNumber(candidate);
    if (seen.has(registryNumber)) continue;
    seen.add(registryNumber);
    refs.push({ registryNumber, law });
  }
  return refs;
}

/** Вложение, на которое ссылается XML документа (<attachment> с fileName + url). */
export interface EisAttachmentRef {
  fileName: string;
  url: string;
  description?: string;
}

/**
 * Ищет блоки <attachment>...</attachment> и достаёт пары fileName/url.
 * UNCONFIRMED: точная структура вложений — по официальной XSD типа документа.
 */
export function parseAttachmentRefs(xml: string): EisAttachmentRef[] {
  const blocks = xml.match(/<[^>\s/]*:?attachment(?:\s[^>]*)?>([\s\S]*?)<\/[^>]*:?attachment>/gi) ?? [];
  const refs: EisAttachmentRef[] = [];
  for (const block of blocks) {
    const fileName = extractTagValues(block, "fileName")[0]?.trim();
    const url = extractTagValues(block, "url")[0]?.trim() ?? extractTagValues(block, "fileURL")[0]?.trim();
    if (!fileName || !url) continue;
    const description = extractTagValues(block, "docDescription")[0]?.trim() ?? extractTagValues(block, "description")[0]?.trim();
    refs.push({ fileName, url, description });
  }
  return refs;
}

/** Одна запись внутри архива (ZIP entry либо цельный XML-документ). */
export interface EisArchiveEntry {
  /** Имя файла/записи (для XML — синтетическое). */
  fileName: string;
  bytes: Uint8Array;
  contentType?: string;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Минимальный ZIP-reader: central directory + stored(0)/deflate(8).
 * Без внешних зависимостей (node:zlib для inflate). Каталоги пропускаются.
 */
export function listZipEntries(bytes: Uint8Array): EisArchiveEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new EisError("DOCUMENT_ERROR", "Архив похож на ZIP, но End-of-Central-Directory не найден");
  const totalEntries = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);
  const entries: EisArchiveEntry[] = [];
  const decoder = new TextDecoder("utf-8");
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(cdOffset, true) !== 0x02014b50) {
      throw new EisError("DOCUMENT_ERROR", "Повреждённый central directory ZIP-архива");
    }
    const method = view.getUint16(cdOffset + 10, true);
    const compressedSize = view.getUint32(cdOffset + 20, true);
    const uncompressedSize = view.getUint32(cdOffset + 24, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);
    const nameBytes = bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen);
    const fileName = decoder.decode(nameBytes);
    // ZIP-bomb: 512 МБ на запись достаточно для любого тендерного документа
    if (uncompressedSize > 512 * 1024 * 1024) {
      throw new EisError("DOCUMENT_ERROR", `Запись ${fileName} слишком велика после распаковки (${uncompressedSize} байт)`);
    }
    cdOffset += 46 + nameLen + extraLen + commentLen;
    if (fileName.endsWith("/")) continue; // каталог
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new EisError("DOCUMENT_ERROR", `Повреждённый local header записи ${fileName}`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    let content: Uint8Array;
    if (method === 0) content = data;
    else if (method === 8) content = inflateRawSync(data);
    else throw new EisError("DOCUMENT_ERROR", `Неподдерживаемый метод сжатия (${method}) в записи ${fileName}`);
    entries.push({ fileName, bytes: content });
  }
  return entries;
}

function findEndOfCentralDirectory(view: DataView): number {
  const minStart = Math.max(0, view.byteLength - 65557);
  for (let i = view.byteLength - 22; i >= minStart; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * Разбирает скачанный payload СОИ на записи документов.
 * ZIP -> по записям; иначе -> одна XML-запись.
 */
export function splitArchivePayload(payload: Uint8Array, registryNumber: string): EisArchiveEntry[] {
  if (!isZip(payload)) {
    return [{ fileName: `${registryNumber}.xml`, bytes: payload, contentType: "application/xml" }];
  }
  return listZipEntries(payload);
}

/** Строит метаданные документа из записи архива (hash/localPath проставляет storage). */
export function archiveEntryToMetadata(
  entry: EisArchiveEntry,
  tender: EisTenderRef,
  source: string,
  downloadedAt: string,
): EisDocumentMetadata {
  return {
    tenderRegistryNumber: tender.registryNumber,
    law: tender.law,
    documentId: entry.fileName,
    documentType: guessDocumentType(entry.fileName),
    fileName: entry.fileName.split("/").pop() ?? entry.fileName,
    contentType: entry.contentType ?? guessContentType(entry.fileName),
    source,
    downloadedAt,
  };
}

/** Метаданные для вложения, на которое XML ссылается внешним URL (скачивается отдельно). */
export function attachmentRefToMetadata(
  ref: EisAttachmentRef,
  tender: EisTenderRef,
  downloadedAt: string,
): EisDocumentMetadata {
  return {
    tenderRegistryNumber: tender.registryNumber,
    law: tender.law,
    documentId: ref.url,
    documentType: "attachment",
    fileName: ref.fileName,
    contentType: guessContentType(ref.fileName),
    source: ref.url,
    downloadedAt,
    raw: ref.description ? { description: ref.description } : undefined,
  };
}

function guessDocumentType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.includes("notif") || lower.includes("извещ")) return "notification";
  if (lower.includes("protocol") || lower.includes("протокол")) return "protocol";
  if (lower.includes("doc") && lower.endsWith(".xml")) return "documentXml";
  const ext = lower.split(".").pop() ?? "";
  return ext ? `file.${ext}` : "file";
}

function guessContentType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xml")) return "application/xml";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".sig")) return "application/octet-stream";
  return "application/octet-stream";
}

/** Экранирование значений для SOAP-конверта. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
