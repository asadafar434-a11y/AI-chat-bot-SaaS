// Тесты (npm test) запускают модули приложения без сборки. Здесь импорт «@/…» превращается в путь к src/,
// у относительного импорта без расширения дописывается .ts, «next/server» ведёт к файлу next/server.js (у пакета next
// нет карты exports, и Node без неё расширение не подставляет), а «server-only» заменяется пустым модулем.
// JSON из src (тексты законов) читается без пометки with { type: "json" } — как у сборщика Next.js.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";

const SRC = new URL("../src/", import.meta.url);

function withExtension(base) {
  for (const ext of ["", ".ts", "/index.ts"]) {
    const url = new URL(base.href + ext);
    if (existsSync(fileURLToPath(url)) && !url.pathname.endsWith("/")) return url.href;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (/^next\/[\w-]+$/.test(specifier)) return next(`${specifier}.js`, context);
  if (specifier.startsWith("@/")) {
    const url = withExtension(new URL(specifier.slice(2), SRC));
    if (url) return next(url, context);
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const url = withExtension(new URL(specifier, context.parentURL));
    if (url) return next(url, context);
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith(SRC.href) && url.endsWith(".json")) {
    return { format: "json", source: await readFile(new URL(url), "utf8"), shortCircuit: true };
  }
  return next(url, context);
}

// Хуки работают в отдельном потоке; регистрируем их один раз — из основного.
if (isMainThread) register(import.meta.url);
