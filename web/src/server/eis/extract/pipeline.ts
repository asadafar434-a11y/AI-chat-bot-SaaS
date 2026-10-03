/**
 * EIS Document Intelligence — pipeline извлечения.
 *
 * RAW document → detect format → extract content → pages/blocks/tables с source →
 * normalized JSON (data/normalized/documents/<registry>/<documentId>.json).
 * RAW-файлы НЕ изменяются и НЕ перемещаются.
 *
 * Идемпотентность: повторный запуск сверяет sourceSha256 + extractorVersion
 * в готовом JSON — совпали → пропуск без переработки (skipped). Hash изменился
 * или экстрактор обновился → новая версия. --force перерабатывает всё.
 * Один повреждённый файл не роняет обработку закупки (failed + error в JSON).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../storage.ts";
import { safeFileName } from "../storage.ts";
import { resolveLocalPath } from "../storage.ts";
import type { EisTenderManifest } from "../types.ts";
import { listZipEntries } from "../documents.ts";
import { detectFormat } from "./detect.ts";
import { extractDocx } from "./docx.ts";
import { NoopOcrProvider, OCR_NOT_CONFIGURED, type OcrProvider } from "./ocr.ts";
import { extractPdf } from "./pdf.ts";
import type {
  EisDocFormat,
  EisExtractStats,
  EisExtractionInfo,
  EisExtractionMethod,
  EisNormalizedDocument,
  EisPage,
  EisTable,
} from "./types.ts";
import { EIS_DOCUMENT_SCHEMA_VERSION, EIS_EXTRACTOR_VERSION } from "./types.ts";
import { extractXlsx } from "./xlsx.ts";
import { extractXml } from "./xml.ts";

export interface ExtractDocumentInput {
  id: string;
  tenderRegistryNumber: string;
  fileName: string;
  documentType: string;
  bytes: Uint8Array;
  sha256?: string;
  size?: number;
}

export interface ExtractOptions {
  ocrProvider?: OcrProvider;
  /** Глубина рекурсии ZIP (0 = сам архив). */
  depth?: number;
}

const MAX_ZIP_ENTRIES = 100;
const MAX_ZIP_DEPTH = 3;

const noopOcr = (): OcrProvider => new NoopOcrProvider();

function baseDocument(input: ExtractDocumentInput, sha: string, format: EisDocFormat): EisNormalizedDocument["document"] {
  return {
    id: input.id,
    tenderRegistryNumber: input.tenderRegistryNumber,
    fileName: input.fileName,
    documentType: input.documentType,
    format,
    sha256: sha,
    size: input.size ?? input.bytes.byteLength,
  };
}

function finished(
  input: ExtractDocumentInput,
  sha: string,
  format: EisDocFormat,
  method: EisExtractionMethod,
  partial: {
    pages: EisPage[];
    tables: EisTable[];
    status: EisExtractionInfo["status"];
    textStatus?: EisExtractionInfo["textStatus"];
    ocrError?: string;
    error?: string;
    ocrPages?: number[];
    truncated?: boolean;
    elements?: EisNormalizedDocument["elements"];
    xmlSource?: string;
    children?: EisNormalizedDocument[];
  },
): EisNormalizedDocument {
  return {
    schemaVersion: EIS_DOCUMENT_SCHEMA_VERSION,
    document: baseDocument(input, sha, format),
    pages: partial.pages,
    tables: partial.tables,
    ...(partial.elements ? { elements: partial.elements } : {}),
    ...(partial.xmlSource !== undefined ? { xmlSource: partial.xmlSource } : {}),
    ...(partial.children ? { children: partial.children } : {}),
    extraction: {
      method,
      status: partial.status,
      ...(partial.textStatus ? { textStatus: partial.textStatus } : {}),
      ...(partial.ocrError ? { ocrError: partial.ocrError } : {}),
      ...(partial.error ? { error: partial.error } : {}),
      stats: {
        pages: partial.pages.length,
        blocks: partial.pages.reduce((n, p) => n + p.blocks.length, 0),
        tables: partial.tables.length,
        ocrPages: partial.ocrPages?.length ?? 0,
        ...(partial.truncated ? { truncated: true } : {}),
      },
    },
    sourceSha256: sha,
    extractorVersion: EIS_EXTRACTOR_VERSION,
    extractedAt: new Date().toISOString(),
  };
}

function failedDocument(input: ExtractDocumentInput, sha: string, format: EisDocFormat, error: unknown): EisNormalizedDocument {
  const message = error instanceof Error ? error.message : String(error);
  return finished(input, sha, format, methodFor(format), {
    pages: [],
    tables: [],
    status: "failed",
    error: message.slice(0, 500),
  });
}

function methodFor(format: EisDocFormat): EisExtractionMethod {
  if (format === "pdf") return "pdf-text";
  if (format === "docx") return "docx";
  if (format === "xlsx") return "xlsx";
  if (format === "xml") return "xml";
  if (format === "zip") return "zip";
  if (format === "image") return "image";
  if (format === "text") return "text";
  return "unknown";
}

async function extractInner(input: ExtractDocumentInput, sha: string, format: EisDocFormat, opts: ExtractOptions): Promise<EisNormalizedDocument> {
  const ocr = opts.ocrProvider ?? noopOcr();
  const depth = opts.depth ?? 0;

  if (format === "pdf") {
    // Табличная разметка getTable — best effort внутри extractPdf (ошибки не роняют извлечение).
    const result = await extractPdf(input.bytes, { ocr, ocrPages: "auto" });
    const needsOcr = result.textStatus === "ocr_required";
    const partialOcr = result.textStatus === "mixed" && result.ocrPages.length === 0;
    const ocrMissing = (needsOcr || partialOcr) && !ocr.configured;
    if (needsOcr && ocrMissing) {
      return finished(input, sha, format, "pdf-text", {
        pages: result.pages,
        tables: result.tables,
        status: "ocr_required",
        textStatus: "ocr_required",
        ocrError: OCR_NOT_CONFIGURED,
        truncated: result.truncated || undefined,
      });
    }
    const usedOcr = result.ocrPages.length > 0;
    return finished(input, sha, format, usedOcr ? "pdf-ocr" : "pdf-text", {
      pages: result.pages,
      tables: result.tables,
      status: result.truncated ? "partial" : partialOcr && !ocr.configured ? "partial" : "complete",
      textStatus: result.textStatus,
      ...(partialOcr && !ocr.configured ? { ocrError: OCR_NOT_CONFIGURED } : {}),
      ocrPages: result.ocrPages,
      truncated: result.truncated || undefined,
    });
  }

  if (format === "docx") {
    const result = extractDocx(input.bytes);
    const empty = result.pages.every((p) => p.blocks.length === 0);
    return finished(input, sha, format, "docx", {
      pages: result.pages,
      tables: result.tables,
      status: result.truncated ? "partial" : "complete",
      textStatus: empty ? "empty" : "text",
      truncated: result.truncated || undefined,
    });
  }

  if (format === "xlsx") {
    const result = await extractXlsx(input.bytes);
    return finished(input, sha, format, "xlsx", {
      pages: result.pages,
      tables: result.tables,
      status: result.truncated ? "partial" : "complete",
      textStatus: result.tables.length > 0 ? "text" : "empty",
      truncated: result.truncated || undefined,
    });
  }

  if (format === "xml") {
    const source = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
    const result = extractXml(source);
    return finished(input, sha, format, "xml", {
      pages: result.pages,
      tables: [],
      status: result.truncated ? "partial" : "complete",
      textStatus: result.elements.length > 0 ? "text" : "empty",
      truncated: result.truncated || undefined,
      elements: result.elements,
      xmlSource: source,
    });
  }

  if (format === "zip") {
    return extractZip(input, sha, opts, depth, ocr);
  }

  if (format === "image") {
    if (!ocr.configured) {
      return finished(input, sha, format, "image", {
        pages: [{ pageNumber: 1, blocks: [{ id: "b1", type: "image", text: "", source: { kind: "image", page: 1 } }] }],
        tables: [],
        status: "ocr_required",
        textStatus: "ocr_required",
        ocrError: OCR_NOT_CONFIGURED,
      });
    }
    const ocrResult = await ocr.extractOcr({ format: "image", bytes: input.bytes, fileName: input.fileName, pages: [1] });
    const text = ocrResult.pages[0]?.text ?? "";
    return finished(input, sha, format, "image", {
      pages: [
        {
          pageNumber: 1,
          blocks: [
            {
              id: "b1",
              type: "paragraph",
              text,
              source: { kind: "image", page: 1 },
              metadata: { ocr: true, confidence: ocrResult.pages[0]?.confidence },
            },
          ],
          metadata: { ocr: true },
        },
      ],
      tables: [],
      status: "complete",
      textStatus: "text",
      ocrPages: [1],
    });
  }

  if (format === "text") {
    const source = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
    const lines = source.split("\n").map((l) => l.trim()).filter(Boolean);
    return finished(input, sha, format, "text", {
      pages: [
        {
          pageNumber: 1,
          blocks: lines.map((text, i) => ({
            id: `b${i + 1}`,
            type: "paragraph" as const,
            text,
            source: { kind: "text" as const, paragraph: i + 1 },
          })),
        },
      ],
      tables: [],
      status: "complete",
      textStatus: lines.length > 0 ? "text" : "empty",
    });
  }

  return finished(input, sha, format, "unknown", {
    pages: [],
    tables: [],
    status: "failed",
    error: `формат не распознан: ${input.fileName}`,
  });
}

async function extractZip(
  input: ExtractDocumentInput,
  sha: string,
  opts: ExtractOptions,
  depth: number,
  ocr: OcrProvider,
): Promise<EisNormalizedDocument> {
  if (depth >= MAX_ZIP_DEPTH) {
    return finished(input, sha, "zip", "zip", {
      pages: [],
      tables: [],
      status: "failed",
      error: `вложенность ZIP превышает лимит (${MAX_ZIP_DEPTH})`,
    });
  }
  const entries = listZipEntries(input.bytes);
  const limited = entries.slice(0, MAX_ZIP_ENTRIES);
  const children: EisNormalizedDocument[] = [];
  for (const entry of limited) {
    const childBytes = entry.bytes;
    const childSha = sha256Hex(childBytes);
    const childFormat = detectFormat(childBytes, entry.fileName);
    const child: ExtractDocumentInput = {
      id: `${input.id}::${entry.fileName}`,
      tenderRegistryNumber: input.tenderRegistryNumber,
      fileName: entry.fileName.split("/").pop() ?? entry.fileName,
      documentType: childFormat,
      bytes: childBytes,
      sha256: childSha,
      size: childBytes.byteLength,
    };
    try {
      children.push(await extractInner(child, childSha, childFormat, { ocrProvider: ocr, depth: depth + 1 }));
    } catch (error) {
      children.push(failedDocument(child, childSha, childFormat, error));
    }
  }
  const pages: EisPage[] = [];
  const tables: EisTable[] = [];
  for (const child of children) {
    for (const page of child.pages) {
      pages.push({
        ...page,
        blocks: page.blocks.map((b) => ({ ...b, source: { ...b.source, entry: child.document.fileName } })),
      });
    }
    tables.push(...child.tables);
  }
  const badChildren = children.filter((c) => c.extraction.status !== "complete").length;
  return finished(input, sha, "zip", "zip", {
    pages,
    tables,
    // Неполнота ребёнка (failed/partial/ocr_required) делает родителя partial — честно вверх по дереву.
    status: badChildren > 0 || entries.length > limited.length ? "partial" : "complete",
    textStatus: pages.some((p) => p.blocks.some((b) => b.text.trim())) ? "text" : "empty",
    ...(entries.length > limited.length ? { error: `записей больше лимита (${MAX_ZIP_ENTRIES}) — обработаны первые` } : {}),
    children,
  });
}

/** Извлечение одного документа. Контентные ошибки → status=failed в JSON, не исключение. */
export async function extractDocument(input: ExtractDocumentInput, opts: ExtractOptions = {}): Promise<EisNormalizedDocument> {
  const sha = input.sha256 ?? sha256Hex(input.bytes);
  if (input.bytes.byteLength === 0) return failedDocument(input, sha, "unknown", new Error("пустой файл"));
  const format = detectFormat(input.bytes, input.fileName);
  try {
    return await extractInner(input, sha, format, opts);
  } catch (error) {
    return failedDocument(input, sha, format, error);
  }
}

// ── Tender-уровень: поиск RAW по manifest + идемпотентная запись ──────────────

export interface TenderExtractOptions {
  ocrProvider?: OcrProvider;
  force?: boolean;
}

export interface FoundTenderDir {
  law: string;
  dir: string;
  manifest: EisTenderManifest;
}

/** Ищет каталоги закупки по registry во всех raw/<law>/YYYY/MM. */
export function findTenderDirs(storagePath: string, registryNumber: string): FoundTenderDir[] {
  const out: FoundTenderDir[] = [];
  const rawRoot = join(storagePath, "raw");
  if (!existsSync(rawRoot)) return out;
  for (const law of readdirSync(rawRoot, { withFileTypes: true })) {
    if (!law.isDirectory()) continue;
    const lawDir = join(rawRoot, law.name);
    for (const year of readdirSync(lawDir, { withFileTypes: true })) {
      if (!year.isDirectory()) continue;
      for (const month of readdirSync(join(lawDir, year.name), { withFileTypes: true })) {
        if (!month.isDirectory()) continue;
        const dir = join(lawDir, year.name, month.name, registryNumber);
        const manifestPath = join(dir, "manifest.json");
        if (!existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as EisTenderManifest;
          out.push({ law: law.name, dir, manifest });
        } catch {
          // Битый manifest — пропускаем (extraction его не чинит).
        }
      }
    }
  }
  return out;
}

export function resolveDocumentsDir(storagePath: string, registryNumber: string): string {
  return join(storagePath, "normalized", "documents", registryNumber);
}

/**
 * Путь normalized JSON. Один documentId — один файл (текущая версия).
 * Изменившийся hash перезаписывает тот же путь (старое восстанавливается из
 * неизменного RAW повторным извлечением). Настоящая коллизия имён РАЗНЫХ
 * документов (одинаковый санитайз) — суффикс по sha.
 */
export function resolveDocumentPath(documentsDir: string, documentId: string, fileName: string, sha: string): string {
  const base = safeFileName(documentId, fileName).replace(/\.json$/i, "");
  const plain = join(documentsDir, `${base}.json`);
  const existing = readExistingDocument(plain);
  // Тот же документ (включая новую версию по изменившемуся hash) — перезапись
  // того же пути. Чужой документ с тем же санитайзом — суффикс по sha.
  if (!existing || existing.document.id === documentId) return plain;
  return join(documentsDir, `${base}__${sha.slice(0, 8)}.json`);
}

function readExistingDocument(path: string): EisNormalizedDocument | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as EisNormalizedDocument;
    if (parsed && parsed.schemaVersion === EIS_DOCUMENT_SCHEMA_VERSION && typeof parsed.sourceSha256 === "string") {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function writeDocument(path: string, doc: EisNormalizedDocument): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2), "utf-8");
}

/** Есть ли статус в документе или любом его ZIP-потомке. */
function subtreeHasStatus(doc: EisNormalizedDocument, status: EisNormalizedDocument["extraction"]["status"]): boolean {
  if (doc.extraction.status === status) return true;
  return (doc.children ?? []).some((child) => subtreeHasStatus(child, status));
}

/**
 * Обрабатывает закупку: все документы из manifest.json → normalized documents.
 * RAW читается по localPath (байт-в-байт, без изменений).
 */
export async function extractTender(
  storagePath: string,
  registryNumber: string,
  opts: TenderExtractOptions = {},
): Promise<EisExtractStats> {
  const stats: EisExtractStats = {
    tenderRegistryNumber: registryNumber,
    documents: 0,
    pages: 0,
    tables: 0,
    ocrRequired: 0,
    failed: 0,
    skipped: 0,
  };
  const found = findTenderDirs(storagePath, registryNumber);
  if (found.length === 0) {
    throw new Error(`Закупка ${registryNumber} не найдена в ${storagePath}/raw (нет manifest.json)`);
  }
  const documentsDir = resolveDocumentsDir(storagePath, registryNumber);
  for (const { manifest } of found) {
    for (const meta of manifest.documents) {
      if (!meta.localPath || !meta.sha256) {
        stats.failed++;
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(readFileSync(resolveLocalPath(storagePath, meta.localPath)));
      } catch {
        stats.failed++;
        continue;
      }
      const sha = sha256Hex(bytes);
      const outPath = resolveDocumentPath(documentsDir, meta.documentId, meta.fileName, sha);
      if (!opts.force) {
        const existing = readExistingDocument(outPath);
        if (existing && existing.sourceSha256 === sha && existing.extractorVersion === EIS_EXTRACTOR_VERSION) {
          stats.skipped++;
          stats.documents++;
          stats.pages += existing.pages.length;
          stats.tables += existing.tables.length;
          if (subtreeHasStatus(existing, "ocr_required")) stats.ocrRequired++;
          if (subtreeHasStatus(existing, "failed")) stats.failed++;
          continue;
        }
      }
      const doc = await extractDocument(
        {
          id: meta.documentId,
          tenderRegistryNumber: registryNumber,
          fileName: meta.fileName,
          documentType: meta.documentType,
          bytes,
          sha256: sha,
          size: bytes.byteLength,
        },
        { ocrProvider: opts.ocrProvider },
      );
      writeDocument(outPath, doc);
      stats.documents++;
      stats.pages += doc.pages.length;
      stats.tables += doc.tables.length;
      // ZIP-дети агрегата страниц/таблиц уже внутри родителя (см. extractZip);
      // ocrRequired/failed считаем по всему поддереву, чтобы сканы в архивах не терялись.
      if (subtreeHasStatus(doc, "ocr_required")) stats.ocrRequired++;
      if (subtreeHasStatus(doc, "failed")) stats.failed++;
      // ZIP-дети учитываются в статистике страниц/таблиц родителя (см. extractZip).
    }
  }
  return stats;
}
