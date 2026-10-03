/**
 * EIS Collector v1 — общие типы.
 *
 * Модуль изолирован от production UI и существующей tender/application
 * business-логики: только сбор RAW/SILVER датасета закупок ЕИС.
 *
 * Источник истины по протоколу — официальная документация ЕИС
 * (раздел «Документы»: форматы информационного взаимодействия по 44-ФЗ/223-ФЗ,
 * «Инструкция по использованию сервисов отдачи информации ЕИС»).
 * Всё, что подтверждено только сторонними источниками (статьи, примеры),
 * помечено комментарием UNCONFIRMED и вынесено в конфигурацию.
 */

/** Правовой контур закупки. 223-ФЗ архитектурно подготовлен, см. Eis223Adapter. */
export type EisLaw = "44fz" | "223fz";

/** Фильтры discovery. Имена полей — внутренние; маппинг в параметры СОИ — в discovery.ts. */
export interface EisDiscoveryFilters {
  law: EisLaw;
  /** Код региона заказчика (например "77" — Москва). TODO: сверить справочник регионов СОИ. */
  region?: string;
  /** Включительно, формат YYYY-MM-DD. */
  dateFrom?: string;
  /** Включительно, формат YYYY-MM-DD. */
  dateTo?: string;
  /**
   * Тип процедуры/документа (например "epNotificationEF2020").
   * UNCONFIRMED: точный перечень значений — по актуальной XSD getDocsIP-ws-api.xsd.
   */
  procurementType?: string;
}

/** Ссылка на закупку, полученная из discovery. */
export interface EisTenderRef {
  registryNumber: string;
  law: EisLaw;
  /** Сырые объективные поля, если их отдал discovery (без интерпретации). */
  raw?: Record<string, string>;
}

/**
 * Метаданные одного документа закупки.
 * Если ЕИС предоставляет page/document/attachment identifiers — они сохраняются
 * в полях pageId/documentId/attachmentId и в raw.
 */
export interface EisDocumentMetadata {
  tenderRegistryNumber: string;
  law: EisLaw;
  /** Идентификатор документа в ЕИС (documentId / eis_id / имя записи в архиве). */
  documentId: string;
  /** Тип документа по схеме ЕИС (например documentType44). */
  documentType: string;
  fileName: string;
  contentType?: string;
  /** Источник: URL архива СОИ или путь внутри архива. */
  source?: string;
  publishedAt?: string;
  downloadedAt: string;
  sha256?: string;
  size?: number;
  /** Относительный путь к RAW-файлу от корня хранилища. */
  localPath?: string;
  /** true, если байты уже были в хранилище (тот же SHA-256) и файл переиспользован. */
  reused?: boolean;
  /** Идентификатор страницы/вложения ЕИС, если предоставлен. */
  pageId?: string;
  attachmentId?: string;
  /** Неразобранные дополнительные поля ответа ЕИС (объективные, без секретов). */
  raw?: Record<string, string>;
}

/** Версия схемы manifest.json. Инкрементировать при несовместимом изменении формата. */
export const EIS_MANIFEST_SCHEMA_VERSION = 1;

/** Версия коллектора, пишется в manifest.json. */
export const EIS_COLLECTOR_VERSION = "0.1.0";

/** Манифест одной закупки: data/raw/{law}/YYYY/MM/{registry}/manifest.json */
export interface EisTenderManifest {
  schemaVersion: number;
  tenderRegistryNumber: string;
  law: EisLaw;
  metadata: Record<string, string>;
  documents: EisDocumentMetadata[];
  collectedAt: string;
  collectorVersion: string;
}

/**
 * Нормализованная запись (SILVER). Только объективные метаданные из ЕИС,
 * без LLM-извлечения и без интерпретации требований.
 */
export interface EisNormalizedTender {
  schemaVersion: number;
  registryNumber: string;
  law: EisLaw;
  dateFrom?: string;
  dateTo?: string;
  customer?: string;
  customerInn?: string;
  procurementMethod?: string;
  price?: number;
  currency?: string;
  status?: string;
  documents: EisDocumentMetadata[];
  /** Относительные ссылки на RAW-файлы. */
  rawRefs: string[];
  collectedAt: string;
  collectorVersion: string;
}

/** Прогресс идемпотентных повторных запусков: data/progress.json */
export interface EisProgress {
  version: 1;
  updatedAt: string;
  /** registryNumber -> ISO-дата успешной обработки. */
  completed: Record<string, string>;
}

/** Статистика одного запуска коллектора (без секретов, только техн. идентификаторы). */
export interface EisCollectorStats {
  dryRun: boolean;
  law: EisLaw;
  found: number;
  /** Сколько закупок взято в работу после применения maxTenders. */
  toProcess: number;
  succeeded: number;
  failed: number;
  documentsExpected: number;
  documentsDownloaded: number;
  documentsReused: number;
  /** registryNumber каждой закупки, взятой в работу. */
  processedRegistryNumbers: string[];
  /** registryNumber -> текст ошибки (санитизированный, без секретов). */
  failures: Record<string, string>;
  startedAt: string;
  finishedAt: string;
}

/** Строка структурированного JSON-лога коллектора. */
export interface EisLogRecord {
  timestamp: string;
  level: "info" | "warn" | "error";
  event: string;
  registryNumber?: string;
  law?: EisLaw;
  detail?: Record<string, string | number | boolean>;
}
