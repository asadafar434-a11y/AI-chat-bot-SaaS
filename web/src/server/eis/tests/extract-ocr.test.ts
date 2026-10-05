// EIS Document Intelligence: OCR-абстракция. Запуск: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NoopOcrProvider,
  OCR_NOT_CONFIGURED,
  OcrNotConfiguredError,
  resolveOcrProvider,
  type EisOcrInput,
  type EisOcrResult,
  type OcrProvider,
} from "../extract/ocr.ts";

test("ocr: заглушка не настроена и бросает OCR_NOT_CONFIGURED", async () => {
  const provider: OcrProvider = new NoopOcrProvider();
  assert.equal(provider.configured, false);
  await assert.rejects(() => provider.extractOcr({ format: "pdf", bytes: new Uint8Array(), fileName: "x.pdf", pages: [1] }), (err: unknown) => {
    assert.ok(err instanceof OcrNotConfiguredError && err.code === OCR_NOT_CONFIGURED);
    return true;
  });
});

test("ocr: resolveOcrProvider по умолчанию — заглушка", async () => {
  const saved = process.env["EIS_OCR_PROVIDER"];
  delete process.env["EIS_OCR_PROVIDER"];
  try {
    const provider = await resolveOcrProvider(undefined);
    assert.ok(provider instanceof NoopOcrProvider);
  } finally {
    if (saved !== undefined) process.env["EIS_OCR_PROVIDER"] = saved;
  }
});

test("ocr: mock-провайдер отдаёт постраничный текст с confidence", async () => {
  class MockOcr implements OcrProvider {
    readonly name = "mock";
    readonly configured = true;
    async extractOcr(input: EisOcrInput): Promise<EisOcrResult> {
      return {
        provider: this.name,
        pages: input.pages.map((pageNumber) => ({ pageNumber, text: `Текст страницы ${pageNumber}`, confidence: 0.92 })),
      };
    }
  }
  const provider = new MockOcr();
  const result = await provider.extractOcr({ format: "pdf", bytes: new Uint8Array([1]), fileName: "s.pdf", pages: [2, 3] });
  assert.equal(result.provider, "mock");
  assert.deepEqual(result.pages.map((p) => p.pageNumber), [2, 3]);
  assert.equal(result.pages[0]?.confidence, 0.92);
});
