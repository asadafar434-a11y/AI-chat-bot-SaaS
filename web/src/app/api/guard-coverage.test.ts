// Страж от повторения ошибки: каждый адрес сервера, который обращается к модели ИИ или читает файлы участника, обязан проверять вход
// (requireAiAuth). Прокси пропускает любую куку с «сессионным» именем, поэтому без проверки в самом адресе платным ИИ мог бы
// пользоваться любой посетитель — npm test. Новый адрес с ИИ без охранника остановит этот тест.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";

const API = import.meta.dirname;

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routes(path);
    return name === "route.ts" ? [path] : [];
  });
}

// Признаки того, что адрес тратит ИИ или читает присланные файлы.
const USES_AI = /claude-request|@anthropic-ai\/sdk|askJson|streamClaude|extractText/;

test("адреса, которые используют ИИ или читают файлы, проверяют вход через requireAiAuth", () => {
  const all = routes(API);
  assert.ok(all.length > 20, "адреса найдены");
  const unguarded = all
    .filter((file) => USES_AI.test(readFileSync(file, "utf8")))
    .filter((file) => !readFileSync(file, "utf8").includes("requireAiAuth"))
    .map((file) => relative(API, file).split(sep).join("/"));
  assert.deepEqual(unguarded, [], "эти адреса работают с ИИ или файлами без проверки входа");
});

test("страж видит то, что должен: известные адреса с ИИ в списке проверенных", () => {
  const guarded = routes(API)
    .filter((file) => readFileSync(file, "utf8").includes("requireAiAuth"))
    .map((file) => relative(API, file).split(sep).join("/"));
  for (const name of ["requirements/route.ts", "tp/route.ts", "check/route.ts", "contradictions/route.ts", "chat/route.ts", "documents/route.ts", "my-docs/facts/route.ts", "my-docs/profile/route.ts", "my-docs/sort/route.ts", "tp/zip/route.ts", "search/route.ts"]) {
    assert.ok(guarded.includes(name), `${name} должен проверять вход`);
  }
});

test("файлы Word, PDF и ODT собираются только для вошедшего: охранник стоит в общей части маршрутов", () => {
  const shared = readFileSync(join(API, "../../lib/tp-docx-request.ts"), "utf8");
  assert.match(shared, /export async function fileRoute[\s\S]{0,400}requireAiAuth\(request\)/);
  for (const format of ["docx", "pdf", "odt"]) {
    assert.match(readFileSync(join(API, "tp", format, "route.ts"), "utf8"), /fileRoute\(request, "/, `${format}: маршрут идёт через общую часть с охранником`);
  }
});
