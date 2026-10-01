// Защита исходников от типичных дыр: вставка чужого HTML, ссылки в новой вкладке без защиты, секреты в коде экрана,
// лишнее в хранилище браузера — npm test. Читает исходники обоих приложений и ничего не запускает.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ROOTS = { web: path.join(REPO, "web/src"), screen: path.join(REPO, "design-system/prototype/src") };

type Source = { file: string; text: string; code: string };

function sources(root: string): Source[] {
  const out: Source[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && !name.endsWith(".d.ts")) {
        const text = readFileSync(full, "utf8");
        // Без комментариев: пояснение «не используем innerHTML» — не использование.
        const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        out.push({ file: path.relative(REPO, full).replaceAll("\\", "/"), text, code });
      }
    }
  };
  walk(root);
  return out;
}

const web = sources(ROOTS.web);
const screen = sources(ROOTS.screen);
const all = [...web, ...screen];

test("чужой HTML в страницу не вставляется: dangerouslySetInnerHTML только в стартовом скрипте темы, остального нет", () => {
  const used = all.filter((s) => /dangerouslySetInnerHTML/.test(s.code)).map((s) => s.file);
  assert.deepEqual(used, ["web/src/app/layout.tsx"]);
  // Там в страницу идёт постоянная строка, а не что-то, пришедшее извне.
  const layout = web.find((s) => s.file === "web/src/app/layout.tsx")!;
  assert.match(layout.code, /const THEME_SCRIPT = `[^`$]*`;/, "скрипт темы стал собираться из чего-то, а не из постоянной строки");
  assert.match(layout.code, /__html: THEME_SCRIPT/);
  for (const s of all) {
    for (const bad of [/\.(inner|outer)HTML\b/, /\binsertAdjacentHTML\b/, /\bdocument\.write\b/, /(^|[^.\w])eval\(/, /\bnew Function\(/]) {
      assert.doesNotMatch(s.code, bad, `${s.file}: ${bad}`);
    }
  }
});

test("ссылки в новой вкладке закрыты от страницы-родителя (rel с noopener или noreferrer)", () => {
  for (const s of all) {
    for (const m of s.code.matchAll(/target=["']_blank["']/g)) {
      const around = s.code.slice(Math.max(0, m.index - 250), m.index + 250);
      assert.match(around, /rel=["'][^"']*(noopener|noreferrer)/, `${s.file}: ссылка в новой вкладке без rel`);
    }
  }
});

test("в коде экрана нет ни ключей, ни паролей, ни переменных окружения сервера", () => {
  for (const s of screen) assert.doesNotMatch(s.code, /process\.env|ANTHROPIC|ACCESS_PASSWORD/, s.file);
  // И в клиентских файлах приложения на Next, которые уезжают в браузер.
  for (const s of web.filter((x) => /^["']use client["']/.test(x.text.trimStart()))) {
    assert.doesNotMatch(s.code, /ANTHROPIC|ACCESS_PASSWORD|OPERATOR_|PD_MASK/, s.file);
  }
});

test("в хранилище браузера лежат только настройки: тема, согласие, чтение сканов, отметка уведомлений — токенов и паролей нет", () => {
  const keys = new Set<string>();
  for (const s of all) {
    assert.doesNotMatch(s.code, /document\.cookie\s*=/, `${s.file}: cookie пишет только сервер, с пометкой HttpOnly`);
    assert.doesNotMatch(s.code, /sessionStorage/, s.file);
    for (const m of s.code.matchAll(/(?:KEY|key)\s*=\s*"([^"]+)"/g)) if (/consent|theme|scan|seen|notif/i.test(m[1])) keys.add(m[1]);
  }
  for (const key of keys) assert.doesNotMatch(key, /token|pass|secret|auth|session|key/i, `подозрительный ключ хранилища «${key}»`);
  // Реквизиты, закупки и документы лежат в IndexedDB (lib/db.ts), а не в localStorage.
  for (const s of all.filter((x) => /localStorage\.setItem|\.setItem\(/.test(x.code))) {
    assert.doesNotMatch(s.code, /setItem\([^)]*(profile|purchase|document|password|token)/i, s.file);
  }
});

test("запросы из браузера идут только на свой сервер: ни одного fetch на чужой адрес", () => {
  for (const s of all) assert.doesNotMatch(s.code, /fetch\(\s*["'`]https?:\/\//, `${s.file}: запрос на чужой адрес`);
});
