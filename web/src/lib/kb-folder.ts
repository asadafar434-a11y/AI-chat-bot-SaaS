// Папка с файлами → отчёт по каждому файлу и текст для базы знаний. Чистые функции: читать диск и вызывать
// извлечение будет скрипт scripts/kb-folder.ts. Здесь — что считать готовым текстом, что сканом, что не открылось.
//
// Текст берём только из блоков страниц: в docx таблица уже лежит блоком «table», а отдельный массив таблиц
// повторил бы те же строки. Скан (PDF без текстового слоя) не читается без OCR, а OCR платный — такие файлы
// в отчёте помечаются и в базу не попадают, пока не будет разрешения.

import { createHash } from "node:crypto";
import type { EisNormalizedDocument } from "../server/eis/extract/types.ts";
import type { GoldKind } from "./gold-folder.ts";
import type { DocumentType } from "./kb-types.ts";

export type FileStatus = "readable" | "partial" | "needs_ocr" | "empty" | "unsupported" | "failed" | "archive";

export type FileReport = {
  path: string;
  status: FileStatus;
  chars: number;
  note?: string;
  children: FileReport[];
};

/** Текст документа: блоки по страницам, по порядку. Пустые блоки пропускаются. */
export function documentText(doc: EisNormalizedDocument): string {
  return [...doc.pages]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .flatMap((page) => page.blocks.map((block) => block.text.trim()))
    .filter(Boolean)
    .join("\n\n");
}

/** Отчёт по документу. Архив сам по себе не в базе — отчитываемся по его вложениям. */
export function reportOf(path: string, doc: EisNormalizedDocument): FileReport {
  const children = (doc.children ?? []).map((child) => reportOf(`${path}!${child.document.fileName}`, child));
  const info = doc.extraction;

  if (doc.document.format === "zip") return { path, status: "archive", chars: 0, children };
  if (info.status === "failed") {
    const unsupported = doc.document.format === "unknown";
    return { path, status: unsupported ? "unsupported" : "failed", chars: 0, note: info.error, children };
  }

  const text = documentText(doc);
  if (!text) {
    const scan = info.textStatus === "ocr_required" || info.status === "ocr_required";
    return { path, status: scan ? "needs_ocr" : "empty", chars: 0, children };
  }
  const partial = info.textStatus === "mixed" || info.status === "partial";
  return { path, status: partial ? "partial" : "readable", chars: text.length, note: partial ? "часть страниц без текста" : undefined, children };
}

/** Все отчёты, включая вложения архивов, одним списком. */
export function flattenReports(reports: FileReport[]): FileReport[] {
  return reports.flatMap((r) => [r, ...flattenReports(r.children)]);
}

export function summarize(reports: FileReport[]): Record<FileStatus, number> {
  const counts: Record<FileStatus, number> = { readable: 0, partial: 0, needs_ocr: 0, empty: 0, unsupported: 0, failed: 0, archive: 0 };
  for (const r of flattenReports(reports)) counts[r.status]++;
  return counts;
}

// Вид документа из разметки папки → тип документа в базе знаний. Образцы и протоколы — примеры заполнения;
// всё, что относится к конкретной закупке, — «прочее». Нормативных документов в папке нет.
const KIND_TYPE: Partial<Record<GoldKind, DocumentType>> = {
  "образец участника": "filled_example",
  протокол: "filled_example",
};

export const documentTypeOf = (kind: GoldKind | undefined): DocumentType => (kind && KIND_TYPE[kind]) || "other";

/**
 * Одинаковые тексты в разных местах папки — одна копия. Какая остаётся: обычный файл важнее вложения архива,
 * а из архива — важнее папки «архив 223»; при равенстве — по алфавиту пути.
 */
export function dedupeByText(items: { path: string; text: string }[]): { kept: string[]; duplicates: { path: string; of: string }[] } {
  const rank = (path: string) => (path.includes("!") ? 2 : 0) + (path.startsWith("архив") ? 1 : 0);
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const key = createHash("sha256").update(item.text, "utf8").digest("hex");
    groups.set(key, [...(groups.get(key) ?? []), item.path]);
  }
  const kept: string[] = [];
  const duplicates: { path: string; of: string }[] = [];
  for (const paths of groups.values()) {
    const sorted = [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    kept.push(sorted[0]);
    for (const path of sorted.slice(1)) duplicates.push({ path, of: sorted[0] });
  }
  return { kept: kept.sort(), duplicates: duplicates.sort((a, b) => a.path.localeCompare(b.path)) };
}
