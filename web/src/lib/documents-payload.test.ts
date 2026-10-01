// Документы уходят на сервер без карты (forServer): карта — откуда какой кусок текста — нужна только браузеру, а запрос
// от неё тяжелее на десятки процентов. Тест просматривает исходники и не даёт забыть forServer у нового запроса — npm test.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [path.resolve(here, ".."), path.resolve(here, "../../../design-system/prototype/src")];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx|mjs)$/.test(entry.name) ? [full] : [];
  });
}

// Тело вызова JSON.stringify(...) — до закрывающей скобки, с учётом строк.
function stringifyBodies(code: string): string[] {
  const bodies: string[] = [];
  for (let at = code.indexOf("JSON.stringify("); at >= 0; at = code.indexOf("JSON.stringify(", at + 1)) {
    let depth = 0;
    let quote = "";
    let i = at + "JSON.stringify".length;
    const start = i + 1;
    for (; i < code.length; i++) {
      const ch = code[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) break;
    }
    bodies.push(code.slice(start, i));
  }
  return bodies;
}

// В теле запроса документы закупки или заявки идут не через forServer.
function leaks(body: string): boolean {
  for (const m of body.matchAll(/(?:^|[{,\s])(?:documents|application)\s*:\s*([^\s,}][^,}]*)/g)) if (!m[1].startsWith("forServer(")) return true;
  return /(?:^|[{,])\s*(?:documents|application)\s*(?:,|\}|$)/.test(body);
}

test("проверка ловит запрос с документами без forServer и пропускает правильный", () => {
  assert.equal(leaks("{ documents, application }"), true);
  assert.equal(leaks("{ documents: docs }"), true);
  assert.equal(leaks("{ part, documents, samples: [] }"), true);
  assert.equal(leaks("{ documents: forServer(documents), application: forServer(application) }"), false);
  assert.equal(leaks("{ messages: [], documents: forServer(docs), general: true }"), false);
  assert.equal(leaks("{ files, name }"), false);
  assert.deepEqual(stringifyBodies('a(JSON.stringify({ x: "(", y: f(1) })); b(JSON.stringify(z))'), ['{ x: "(", y: f(1) }', "z"]);
});

test("каждый запрос к серверу отправляет документы через forServer", () => {
  const found: string[] = [];
  let calls = 0;
  for (const file of ROOTS.flatMap(sources)) {
    for (const body of stringifyBodies(readFileSync(file, "utf8"))) {
      calls++;
      if (leaks(body)) found.push(`${path.relative(path.resolve(here, "../../.."), file)}: ${body.replace(/\s+/g, " ").slice(0, 80)}`);
    }
  }
  assert.ok(calls > 10, "просмотрены не все исходники");
  assert.deepEqual(found, []);
});
