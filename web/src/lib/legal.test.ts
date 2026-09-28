// Правовые страницы: открыты без пароля и существуют на самом деле — npm test.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { isLegalPath, LEGAL_PAGES, readOperator } from "./legal.ts";

test("согласие на передачу за рубеж — отдельная страница, открытая без пароля", () => {
  assert.ok(isLegalPath("/consent"));
  assert.ok(isLegalPath("/consent-transfer"));
  assert.ok(isLegalPath("/privacy"));
  assert.equal(isLegalPath("/consent-transfer/x"), false);
  assert.equal(isLegalPath("/"), false);
});

test("у каждого документа из списка есть страница", () => {
  for (const page of LEGAL_PAGES) {
    const file = new URL(`../app${page.href}/page.tsx`, import.meta.url);
    assert.ok(existsSync(file), `нет страницы ${page.href}`);
  }
});

test("пока реквизиты не заданы — видно, каких не хватает", () => {
  const saved = process.env.OPERATOR_NAME;
  delete process.env.OPERATOR_NAME;
  assert.ok(readOperator().missing.includes("OPERATOR_NAME"));
  process.env.OPERATOR_NAME = "ИП Иванова";
  assert.equal(readOperator().name.value, "ИП Иванова");
  if (saved === undefined) delete process.env.OPERATOR_NAME;
  else process.env.OPERATOR_NAME = saved;
});
