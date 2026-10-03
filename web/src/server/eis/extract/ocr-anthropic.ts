/**
 * EIS Document Intelligence — Anthropic OCR-адаптер (opt-in).
 *
 * Единственное место, где extraction встречается с конкретным AI-провайдером.
 * Переиспользует существующее распознавание сканов (@/lib/ocr: renderPages +
 * transcribe) — не дублирует его. Активен только при EIS_OCR_PROVIDER=anthropic
 * и наличии ANTHROPIC_API_KEY; иначе — OcrNotConfiguredError.
 */

import type { EisOcrInput, EisOcrResult, OcrProvider } from "./ocr.ts";
import { OcrNotConfiguredError } from "./ocr.ts";

export class AnthropicOcrProvider implements OcrProvider {
  readonly name = "anthropic";
  readonly configured: boolean;

  constructor(configured: boolean) {
    this.configured = configured;
  }

  async extractOcr(input: EisOcrInput): Promise<EisOcrResult> {
    if (!this.configured) throw new OcrNotConfiguredError();
    // Динамические относительные импорты: SDK и biling-цепочка грузятся только
    // когда провайдер реально выбран (дефолтный путь остаётся AI-free).
    const { PDFParse } = await import("pdf-parse");
    const ocr = await import("../../../lib/ocr.ts");
    if (input.format === "image") {
      const mediaType = /png$/i.test(input.fileName) ? ("image/png" as const) : ("image/jpeg" as const);
      const texts = await ocr.transcribe([{ data: Buffer.from(input.bytes), mediaType }]);
      return {
        provider: this.name,
        pages: [{ pageNumber: input.pages[0] ?? 1, text: (texts[0] ?? "").trim() }],
      };
    }
    const parser = new PDFParse({ data: input.bytes });
    try {
      const images = await ocr.renderPages(parser, input.pages);
      const texts = await ocr.transcribe(images);
      return {
        provider: this.name,
        pages: input.pages.map((pageNumber, i) => ({ pageNumber, text: (texts[i] ?? "").trim() })),
      };
    } finally {
      await parser.destroy();
    }
  }
}

export function createAnthropicOcrProvider(): AnthropicOcrProvider {
  return new AnthropicOcrProvider(Boolean(process.env["ANTHROPIC_API_KEY"]));
}
