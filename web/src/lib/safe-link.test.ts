// Ссылки в ответах ассистента: открывается только безопасное — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isSafeLink } from "./safe-link.ts";

test("безопасно: сайт по http и https, почта, путь на нашем сайте", () => {
  for (const href of ["https://www.consultant.ru/document/", "http://zakupki.gov.ru/epz", "HTTPS://ZAKUPKI.GOV.RU", "mailto:owner@example.ru", "/privacy", "/p/123/package?x=1#y", "/consent-transfer"]) {
    assert.equal(isSafeLink(href), true, href);
  }
});

test("небезопасно: скрипты, данные, файлы, чужой сайт под видом нашего пути, мусор", () => {
  for (const href of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    " javascript:alert(1)",
    "\u0001javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.ru/x",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "\\\\evil.example",
    "https:evil.example",
    "evil.example/path",
    "#",
    "",
  ]) {
    assert.equal(isSafeLink(href), false, JSON.stringify(href));
  }
});
