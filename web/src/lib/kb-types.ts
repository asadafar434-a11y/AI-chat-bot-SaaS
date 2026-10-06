// База знаний продукта (Knowledge Base): общие типы. Отдельна от Golden Dataset: эталон — для проверки качества,
// база знаний — для работы ИИ при обработке заявки. Документы пользователей сюда не попадают (см. kb-ingest.ts).

/** Кто владеет документом. Глобальный — общий для всех продукта, его пишет только администратор с указанием, кто утвердил. */
export type KbOwner = { kind: "global"; approvedBy: string } | { kind: "org"; organizationId: string };

/**
 * Тип документа. От него зависит авторитет (приоритет при конфликте с документами закупки):
 * законы и положения — нормативные; инструкции — проверенные внутренние; образцы — примеры заполнения.
 */
export const DOCUMENT_TYPES = ["law", "regulation", "instruction", "template", "filled_example", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const AUTHORITIES = ["normative", "instruction", "example", "other"] as const;
export type Authority = (typeof AUTHORITIES)[number];

const AUTHORITY_OF: Record<DocumentType, Authority> = {
  law: "normative",
  regulation: "normative",
  instruction: "instruction",
  template: "example",
  filled_example: "example",
  other: "other",
};

export const authorityOf = (type: DocumentType): Authority => AUTHORITY_OF[type];

/**
 * Приоритет источников при ответе: меньше — важнее. Документы текущей закупки стоят выше всего этого
 * и в базу знаний не входят: их даёт сам процесс обработки заявки (rag.ts ставит их первыми).
 */
export const AUTHORITY_RANK: Record<Authority, number> = { normative: 2, instruction: 3, example: 4, other: 5 };

export const LAW_TYPES = ["44-FZ", "223-FZ"] as const;
export const PROCUREMENT_TYPES = ["auction", "tender", "quotation", "proposals"] as const;

/** Метаданные для фильтрации. Неизвестное значение — null; неверное значение из списка — ошибка приёма. */
export type KbMeta = {
  documentType: DocumentType;
  lawType: (typeof LAW_TYPES)[number] | null;
  procurementType: (typeof PROCUREMENT_TYPES)[number] | null;
  category: string | null;
  topic: string | null;
  tenderPlatform: string | null;
  year: number | null;
  /** Редакция закона или дата документа, если известна. */
  edition: string | null;
  reliability: "official" | "verified" | "unverified";
};

export type KbFilter = Partial<Pick<KbMeta, "documentType" | "lawType" | "procurementType" | "category" | "tenderPlatform" | "year">>;

export type KbDocument = {
  id: string;
  owner: KbOwner;
  /** Ключ документа внутри владельца: по нему приём понимает, новый это документ или новая версия. */
  sourceKey: string;
  name: string;
  /** Откуда взято: адрес официального источника или «golden_dataset» и т. п. */
  source: string;
  meta: KbMeta;
  version: number;
  /** sha256 нормализованного текста. Совпал — текст не переразбиваем и не пересчитываем. */
  checksum: string;
  status: "active" | "deleted";
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
};

export type KbChunk = {
  id: string;
  documentId: string;
  /** Владелец продублирован сюда, чтобы поиск отбирал фрагменты по владельцу в самом запросе. */
  ownerKey: string;
  chunkIndex: number;
  heading: string | null;
  text: string;
  /** sha256 текста, который индексируется (заголовок + текст). По нему не пересчитываем одинаковые фрагменты. */
  hash: string;
  embedding: number[];
  embeddingModel: string;
  createdAt: string;
};

/** Ключ владельца для фильтра и для строки в базе: «global» или «org:<id>». */
export const ownerKeyOf = (owner: KbOwner): string => (owner.kind === "global" ? "global" : `org:${owner.organizationId}`);

export type KbErrorCode = "invalid_owner" | "invalid_meta" | "empty_text" | "invalid_scope" | "invalid_source_key";

// Поле объявлено явно: режим запуска TypeScript без преобразования не понимает параметров-свойств в конструкторе.
export class KbError extends Error {
  code: KbErrorCode;
  constructor(code: KbErrorCode, message: string) {
    super(message);
    this.name = "KbError";
    this.code = code;
  }
}
