// EIS Document Intelligence: detect формата + ZIP-имена. Запуск: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { detectFormat, extensionOf, listZipNames } from "../extract/detect.ts";
import { makeZip } from "./helpers.ts";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test("detect: сигнатуры PDF/ZIP/PNG/JPEG/XML", () => {
  assert.equal(detectFormat(enc("%PDF-1.4 rest"), "a.pdf"), "pdf");
  assert.equal(detectFormat(makeZip([{ name: "x.txt", data: enc("hi") }]), "a.zip"), "zip");
  assert.equal(detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "a.png"), "image");
  assert.equal(detectFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "a.jpg"), "image");
  assert.equal(detectFormat(enc('<?xml version="1.0"?><root/>'), "notice.xml"), "xml");
  assert.equal(detectFormat(enc("  \n<root/>"), "noext"), "xml");
});

test("detect: docx/xlsx по именам частей ZIP", () => {
  assert.equal(detectFormat(makeZip([{ name: "word/document.xml", data: enc("<w/>") }]), "a.docx"), "docx");
  assert.equal(detectFormat(makeZip([{ name: "xl/workbook.xml", data: enc("<w/>") }]), "a.xlsx"), "xlsx");
});

test("detect: текст и неизвестное", () => {
  assert.equal(detectFormat(enc("plain text readme"), "read.txt"), "text");
  assert.equal(detectFormat(enc("plain text"), "NOEXT"), "text");
  assert.equal(detectFormat(new Uint8Array([0, 1, 2, 3, 4, 5]), "blob.bin"), "unknown");
  assert.equal(detectFormat(enc("%PDF-"), "renamed.bin"), "pdf");
});

test("detect: битый ZIP — имена не читаются", () => {
  assert.equal(listZipNames(enc("PK\u0003\u0004garbage")), undefined);
  assert.equal(listZipNames(enc("short")), undefined);
  const names = listZipNames(makeZip([{ name: "a/b.txt", data: enc("x") }]));
  assert.deepEqual(names, ["a/b.txt"]);
});

test("detect: расширение файла", () => {
  assert.equal(extensionOf("dir/Документ.DOCX"), "docx");
  assert.equal(extensionOf("noext"), "");
});
