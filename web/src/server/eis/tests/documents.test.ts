// EIS Collector v1: unit-тесты парсинга (registry numbers, архивы, вложения, ZIP). Запуск: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archiveEntryToMetadata,
  attachmentRefToMetadata,
  escapeXml,
  extractTagValues,
  isRegistryNumber,
  listZipEntries,
  parseArchiveUrls,
  parseAttachmentRefs,
  parseRegistryNumber,
  parseRegistryNumbers,
  splitArchivePayload,
} from "../documents.ts";
import { makeZip } from "./helpers.ts";

test("parsing: registry number 44-ФЗ (19 цифр) и 223-ФЗ (11 цифр)", () => {
  assert.equal(parseRegistryNumber("0373100130926000001"), "0373100130926000001");
  assert.equal(parseRegistryNumber(" 32312304715 "), "32312304715");
  assert.ok(isRegistryNumber("0373100130926000001"));
  assert.ok(!isRegistryNumber("ABC-123"));
  assert.ok(!isRegistryNumber("12345"));
  assert.ok(!isRegistryNumber("0373100130926000001-extra"));
  assert.throws(() => parseRegistryNumber(""), /Некорректный registry number/);
});

test("parsing: теги с неймспейс-префиксами и дубликаты номеров", () => {
  const xml = `<r><ns2:reestrNumber>0373100130926000001</ns2:reestrNumber><reestrNumber>0373100130926000001</reestrNumber><purchaseNumber>32312304715</purchaseNumber></r>`;
  assert.deepEqual(extractTagValues(xml, "reestrNumber"), ["0373100130926000001", "0373100130926000001"]);
  const refs = parseRegistryNumbers(xml, "44fz");
  assert.deepEqual(
    refs.map((r) => r.registryNumber),
    ["0373100130926000001", "32312304715"],
  );
  assert.ok(refs.every((r) => r.law === "44fz"));
});

test("parsing: archiveUrl из SOAP-ответа (дедуп)", () => {
  const xml = `<dataInfo><archiveUrl>https://a/x.zip</archiveUrl><archiveUrl>https://a/x.zip</archiveUrl></dataInfo>`;
  assert.deepEqual(parseArchiveUrls(xml), ["https://a/x.zip"]);
  assert.deepEqual(parseArchiveUrls("<empty/>"), []);
});

test("parsing: вложения attachment с fileName+url", () => {
  const xml =
    `<root><attachment><fileName>doc.pdf</fileName><url>https://f/1</url>` +
    `<docDescription>ТЗ</docDescription></attachment>` +
    `<attachment><fileName>без url</fileName></attachment></root>`;
  const refs = parseAttachmentRefs(xml);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.fileName, "doc.pdf");
  assert.equal(refs[0]?.url, "https://f/1");
  const meta = attachmentRefToMetadata(refs[0]!, { registryNumber: "32312304715", law: "223fz" }, "2026-10-03T00:00:00.000Z");
  assert.equal(meta.documentType, "attachment");
  assert.equal(meta.documentId, "https://f/1");
});

test("parsing: не-ZIP payload — одна XML-запись", () => {
  const bytes = new TextEncoder().encode("<notice/>");
  const entries = splitArchivePayload(bytes, "0373100130926000001");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.fileName, "0373100130926000001.xml");
  const meta = archiveEntryToMetadata(entries[0]!, { registryNumber: "0373100130926000001", law: "44fz" }, "soap-response", "2026-10-03T00:00:00.000Z");
  assert.equal(meta.contentType, "application/xml");
});

test("parsing: ZIP stored + deflate разбираются побайтово", () => {
  const a = new TextEncoder().encode("hello-raw");
  const b = new TextEncoder().encode("x".repeat(5000));
  const zip = makeZip([
    { name: "docs/a.xml", data: a, method: 0 },
    { name: "docs/b.bin", data: b, method: 8 },
  ]);
  const entries = listZipEntries(zip);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.fileName, "docs/a.xml");
  assert.deepEqual(Buffer.from(entries[0]!.bytes), Buffer.from(a));
  assert.deepEqual(Buffer.from(entries[1]!.bytes), Buffer.from(b));
});

test("parsing: escapeXml экранирует конверт", () => {
  assert.equal(escapeXml(`<a>&"'`), "&lt;a&gt;&amp;&quot;&apos;");
});
