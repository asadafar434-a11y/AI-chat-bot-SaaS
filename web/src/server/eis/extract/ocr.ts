/**
 * EIS Document Intelligence — OCR-абстракция.
 *
 * Архитектура НЕ привязана к одному AI-провайдеру: экстракторы зависят только
 * от интерфейса OcrProvider. Провайдер по умолчанию отсутствует — в этом случае
 * возвращается код OCR_NOT_CONFIGURED (честная метка, а не выдуманный текст),
 * а документ получает extraction.status = "ocr_required".
 */

import type { EisBlock } from "./types.ts";

export const OCR_NOT_CONFIGURED = "OCR_NOT_CONFIGURED";

/** Вход OCR: сырые байты документа + номера страниц для распознавания (с 1). */
export interface EisOcrInput {
  format: "pdf" | "image";
  bytes: Uint8Array;
  fileName: string;
  pages: number[];
}

export interface EisOcrPageResult {
  pageNumber: number;
  text: string;
  /** Уверенность 0..1, если провайдер её сообщает. */
  confidence?: number;
  /** Постраничные блоки провайдера (необязательно — pipeline построит сам). */
  blocks?: EisBlock[];
}

export interface EisOcrResult {
  provider: string;
  pages: EisOcrPageResult[];
}

export interface OcrProvider {
  readonly name: string;
  /** false у заглушки по умолчанию: pipeline даже не пытается распознавать. */
  readonly configured: boolean;
  extractOcr(input: EisOcrInput): Promise<EisOcrResult>;
}

export class OcrNotConfiguredError extends Error {
  readonly code = OCR_NOT_CONFIGURED;
  constructor() {
    super(
      "OCR-провайдер не настроен (EIS_OCR_PROVIDER). " +
        "Сканы помечены ocr_required; задайте провайдер и повторите извлечение.",
    );
    this.name = "OcrNotConfiguredError";
  }
}

/** Заглушка по умолчанию: честно сообщает об отсутствии провайдера. */
export class NoopOcrProvider implements OcrProvider {
  readonly name = "none";
  readonly configured = false;
  async extractOcr(): Promise<EisOcrResult> {
    throw new OcrNotConfiguredError();
  }
}

/**
 * Выбор провайдера. "anthropic" — отдельный адаптер поверх существующего
 * распознавания (@/lib/ocr), подключается динамическим импортом и только
 * при явной настройке; всё остальное — заглушка.
 */
export async function resolveOcrProvider(kind: string | undefined): Promise<OcrProvider> {
  const name = (kind ?? process.env["EIS_OCR_PROVIDER"] ?? "none").trim().toLowerCase();
  if (name === "anthropic") {
    const mod = await import("./ocr-anthropic.ts");
    return mod.createAnthropicOcrProvider();
  }
  return new NoopOcrProvider();
}
