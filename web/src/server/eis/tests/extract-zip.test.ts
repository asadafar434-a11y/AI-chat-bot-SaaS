// EIS Document Intelligence: ZIP (вложенные документы, лимиты глубины). Запуск: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pdf } from "../../../lib/pdf-fixtures.ts";
import { extractDocument } from "../extract/pipeline.ts";
import { makeZip } from "./helpers.ts";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const REG = "0373100130926000001";
const input = (bytes: Uint8Array, fileName: string) => ({
  id: fileName,
  tenderRegistryNumber: REG,
  fileName,
  documentType: "archive",
  bytes,
});

test("zip: несколько файлов → дети с форматами и source.entry", async () => {
  const bytes = makeZip([
    { name: "notice.xml", data: enc("<root><a>1</a></root>") },
    { name: "doc.pdf", data: pdf(["Soderzhanie dokumentacii o provedenii zaprosa kotirovok"]) },
  ]);
  const normalized = await extractDocument(input(bytes, "pack.zip"), {});
  assert.equal(normalized.document.format, "zip");
  assert.equal(normalized.extraction.method, "zip");
  assert.equal(normalized.extraction.status, "complete");
  assert.equal(normalized.children?.length, 2);
  const formats = (normalized.children ?? []).map((c) => c.document.format).sort();
  assert.deepEqual(formats, ["pdf", "xml"]);
  // Агрегированные блоки помечены записью архива.
  const entrySources = new Set(normalized.pages.flatMap((p) => p.blocks.map((b) => b.source.entry)));
  assert.ok(entrySources.has("notice.xml"));
  assert.ok(entrySources.has("doc.pdf"));
  assert.ok(normalized.tables.length >= 0);
});

test("zip: вложенность глубже лимита — честный failed у глубокого ребёнка", async () => {
  const l3 = makeZip([{ name: "deep.txt", data: enc("deep") }]);
  const l2 = makeZip([{ name: "l3.zip", data: l3 }]);
  const l1 = makeZip([{ name: "l2.zip", data: l2 }]);
  const bytes = makeZip([{ name: "l1.zip", data: l1 }]);
  const normalized = await extractDocument(input(bytes, "nested.zip"), {});
  const findDeep = (docs: typeof normalized.children): string | undefined => {
    for (const child of docs ?? []) {
      if (child.document.fileName === "deep.txt") return child.extraction.status;
      const nested = findDeep(child.children);
      if (nested) return nested;
    }
    return undefined;
  };
  // Глубина 0→1→2→3: l1(1)→l2(2)→l3(3, failed по лимиту), deep.txt не извлекается.
  assert.equal(normalized.extraction.status, "partial");
  assert.equal(findDeep(normalized.children), undefined);
  const statuses: string[] = [];
  const collect = (docs: typeof normalized.children): void => {
    for (const child of docs ?? []) {
      statuses.push(`${child.document.fileName}:${child.extraction.status}`);
      collect(child.children);
    }
  };
  collect(normalized.children);
  assert.ok(statuses.some((s) => s.includes("failed")), statuses.join(","));
});

test("zip: битый архив → failed без исключения", async () => {
  const normalized = await extractDocument(input(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 7, 7, 7]), "bad.zip"), {});
  assert.equal(normalized.document.format, "zip");
  assert.equal(normalized.extraction.status, "failed");
  assert.ok(normalized.extraction.error);
});
