/**
 * EIS Document Intelligence — нормализованная модель документа.
 *
 * Принцип: сохраняется СТРУКТУРА (страницы/блоки/таблицы), а не одна строка текста.
 * Каждый блок имеет точный источник (source): Requirement Engine и AI в будущем
 * обязаны выдавать «точное место + точную цитату» — источник закладывается здесь.
 *
 * Без AI: извлечение и структурирование; никакого requirement extraction, RAG,
 * embeddings, скоринга и генерации заявок.
 */

/** Формат, определённый по сигнатуре байтов (+ расширение как подсказка). */
export type EisDocFormat = "pdf" | "docx" | "xlsx" | "xml" | "zip" | "image" | "text" | "unknown";

export type EisBlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "table"
  | "image"
  | "footnote"
  | "header"
  | "footer"
  | "unknown";

/**
 * Точный источник блока. Заполняется по формату:
 * PDF — page; DOCX — paragraph (+ heading/list через metadata);
 * XLSX — sheet/row/column/cell; XML — xpath; ZIP — entry + источник внутри.
 */
export interface EisSourceRef {
  kind: "pdf" | "docx" | "xlsx" | "xml" | "zip" | "image" | "text";
  page?: number;
  /** DOCX: порядковый номер абзаца в document.xml с 1. */
  paragraph?: number;
  sheet?: string;
  row?: number;
  column?: number;
  /** XLSX: адрес ячейки, например «F17». */
  cell?: string;
  /** XML: путь элемента, например /nsi:root/nsi:item[2]. */
  xpath?: string;
  /** ZIP: имя записи архива, в которой лежит блок. */
  entry?: string;
}

export interface EisBlock {
  /** Детерминированный id в пределах документа: b1, b2, … */
  id: string;
  type: EisBlockType;
  text: string;
  source: EisSourceRef;
  metadata?: {
    /** heading: уровень (1–6 по стилю Word либо 0 — по виду строки). */
    level?: number;
    byAppearance?: boolean;
    /** list: идентификатор нумерации и уровень вложенности. */
    listId?: string;
    listLevel?: number;
    /** Признак OCR-текста и его уверенность (0..1), если сообщил провайдер. */
    ocr?: boolean;
    confidence?: number;
    /** PDF: страница не читается (сломана кодировка шрифта). */
    garbled?: boolean;
    /** DOCX: в абзаце есть рисунок/чертёж. */
    hasImage?: boolean;
    /** XLSX: ссылка на таблицу документа. */
    tableIndex?: number;
    /** XML: имя элемента и его атрибуты (дубль из elements для удобства цитирования). */
    tag?: string;
    attributes?: Record<string, string>;
    /** footnote: идентификатор сноски в footnotes.xml. */
    noteId?: string;
  };
}

export interface EisCell {
  text: string;
  /** Строка и столбец с 1. */
  row: number;
  column: number;
  metadata?: {
    /** XLSX: адрес («F17»), формула, числовой формат, merge. */
    address?: string;
    formula?: string;
    numberFormat?: string;
    /** Ведомая клетка объединённого диапазона: адрес главной. */
    mergedFrom?: string;
    /** Главная клетка: диапазон, например «B2:C3». */
    mergedRange?: string;
    /** DOCX/PDF: colspan. */
    colSpan?: number;
  };
}

export interface EisTable {
  tableIndex: number;
  pageNumber?: number;
  sheet?: string;
  rows: EisCell[][];
  metadata?: {
    rows: number;
    cols: number;
  };
}

export interface EisPage {
  pageNumber: number;
  blocks: EisBlock[];
  metadata?: {
    /** PDF: качество текстового слоя страницы. */
    quality?: "ok" | "blank" | "garbled";
    /** Страница отдана OCR (целиком или частично). */
    ocr?: boolean;
  };
}

export type EisExtractionMethod =
  | "pdf-text"
  | "pdf-ocr"
  | "docx"
  | "xlsx"
  | "xml"
  | "zip"
  | "image"
  | "text"
  | "unknown";

export type EisExtractionStatus = "complete" | "partial" | "ocr_required" | "failed";

export interface EisExtractionInfo {
  method: EisExtractionMethod;
  status: EisExtractionStatus;
  /** Состояние текстового слоя: text | ocr_required | mixed | empty. */
  textStatus?: "text" | "ocr_required" | "mixed" | "empty";
  /** Код причины отсутствия OCR-текста. OCR_NOT_CONFIGURED — провайдер не настроен (не ошибка). */
  ocrError?: string;
  /** Текст ошибки при status=failed (без секретов — секретов в экстракции нет). */
  error?: string;
  stats: {
    pages: number;
    blocks: number;
    tables: number;
    ocrPages: number;
    truncated?: boolean;
  };
}

/** Один элемент XML: путь + текст + атрибуты + namespace (структура не уничтожается). */
export interface EisXmlElement {
  xpath: string;
  tag: string;
  namespace?: string;
  text: string;
  attributes: Record<string, string>;
}

/**
 * Нормализованный документ: data/normalized/documents/<registry>/<documentId>.json
 * RAW-файл при этом НЕ изменяется и НЕ перемещается.
 */
export interface EisNormalizedDocument {
  schemaVersion: 1;
  document: {
    id: string;
    tenderRegistryNumber: string;
    fileName: string;
    documentType: string;
    format: EisDocFormat;
    sha256: string;
    size: number;
  };
  pages: EisPage[];
  tables: EisTable[];
  /** XML: элементы с путями; полный исходник — в xmlSource. */
  elements?: EisXmlElement[];
  xmlSource?: string;
  /** ZIP: рекурсивно извлечённые вложения (глубина ограничена). */
  children?: EisNormalizedDocument[];
  extraction: EisExtractionInfo;
  /** SHA-256 RAW-байтов, из которых построена эта версия (идемпотентность). */
  sourceSha256: string;
  extractorVersion: string;
  extractedAt: string;
}

/** Версия экстрактора: bump при изменении логики извлечения (перезапускает idempotent-пропуски). */
export const EIS_EXTRACTOR_VERSION = "docint-1";

/** Версия схемы normalized document JSON. */
export const EIS_DOCUMENT_SCHEMA_VERSION = 1;

/** Статистика обработки одной закупки (для CLI-вывода). */
export interface EisExtractStats {
  tenderRegistryNumber: string;
  documents: number;
  pages: number;
  tables: number;
  ocrRequired: number;
  failed: number;
  skipped: number;
}
