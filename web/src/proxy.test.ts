// Прокси: вход по паролю, закрытый без пароля хостинг и лимиты запросов — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { ACCESS_COOKIE, accessToken } from "./lib/access.ts";
import { AI_PER_IP, FILES_PER_IP } from "./lib/rate-limit.ts";
import { proxy } from "./proxy.ts";

// Окружение — на время одного теста.
async function withEnv(env: Record<string, string | undefined>, run: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await run();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

let ipSeq = 0;
// У каждого теста свой адрес: счёт лимитов общий на весь процесс.
const nextIp = () => `198.51.100.${++ipSeq}`;
const post = (path: string, ip: string, cookie?: string) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "x-forwarded-for": ip, ...(cookie && { cookie }) },
  });

test("на хостинге без пароля запросы к серверу закрыты, страницы и вход — нет (аудит, п. 5)", async () => {
  await withEnv({ NODE_ENV: "production", ACCESS_PASSWORD: undefined, OPEN_ACCESS: undefined }, async () => {
    const ip = nextIp();
    const api = await proxy(post("/api/chat", ip));
    assert.equal(api.status, 503);
    assert.match(await api.text(), /Сервис закрыт/);
    assert.notEqual((await proxy(post("/api/login", ip))).status, 503);
    assert.notEqual((await proxy(new NextRequest("http://localhost/privacy"))).status, 503);
  });
  await withEnv({ NODE_ENV: "production", ACCESS_PASSWORD: undefined, OPEN_ACCESS: "1" }, async () => {
    assert.notEqual((await proxy(post("/api/chat", nextIp()))).status, 503);
  });
});

test("с паролем: без метки входа — 401 для запросов и переход на вход для страниц", async () => {
  await withEnv({ NODE_ENV: "production", ACCESS_PASSWORD: "секрет", OPEN_ACCESS: undefined }, async () => {
    const api = await proxy(post("/api/requirements", nextIp()));
    assert.equal(api.status, 401);
    const page = await proxy(new NextRequest("http://localhost/p/123/tp"));
    assert.equal(page.status, 307);
    assert.match(page.headers.get("location") ?? "", /\/login\?next=%2Fp%2F123%2Ftp$/);
    // Правовые страницы и вход открыты всем: их читают до входа.
    assert.equal((await proxy(new NextRequest("http://localhost/consent-transfer"))).status, 200);
    // Чужая метка не подходит, своя — пускает.
    const wrong = await proxy(post("/api/chat", nextIp(), `${ACCESS_COOKIE}=${await accessToken("другой")}`));
    assert.equal(wrong.status, 401);
    const right = await proxy(post("/api/chat", nextIp(), `${ACCESS_COOKIE}=${await accessToken("секрет")}`));
    assert.equal(right.status, 200);
  });
});

test("лимит запросов к ИИ с одного адреса: сверх — 429 с текстом и Retry-After (аудит, п. 11)", async () => {
  await withEnv({ NODE_ENV: "development", ACCESS_PASSWORD: undefined }, async () => {
    const ip = nextIp();
    const max = AI_PER_IP[0].max;
    for (let i = 0; i < max; i++) assert.equal((await proxy(post("/api/chat", ip))).status, 200, `запрос ${i + 1}`);
    const over = await proxy(post("/api/tp", ip));
    assert.equal(over.status, 429);
    assert.ok(Number(over.headers.get("retry-after")) > 0);
    assert.match(await over.text(), /Слишком много запросов к ИИ подряд — продолжите через/);
    // Другой адрес считается отдельно, сборка Word и вход не считаются вовсе.
    assert.equal((await proxy(post("/api/chat", nextIp()))).status, 200);
    assert.equal((await proxy(post("/api/tp/docx", ip))).status, 200);
    assert.equal((await proxy(post("/api/tp/pdf", ip))).status, 200);
    assert.equal((await proxy(post("/api/tp/odt", ip))).status, 200);
    assert.equal((await proxy(post("/api/login", ip))).status, 200);
  });
});

test("bearer-ссылки локальной раздачи открыты прокси, остальное хранилище — за входом", async () => {
  await withEnv({ NODE_ENV: "production", ACCESS_PASSWORD: "секрет", OPEN_ACCESS: undefined }, async () => {
    // Подписанная ссылка проверяет себя сама (HMAC + срок в роуте): прокси её пропускает.
    const bearer = await proxy(new NextRequest("http://localhost/api/storage/local/abc.def.0123456789abcdef"));
    assert.equal(bearer.status, 200);
    // Остальные файловые маршруты — только со входом.
    assert.equal((await proxy(post("/api/storage/documents", nextIp()))).status, 401);
  });
});

test("загрузка файлов — свой лимит", async () => {
  await withEnv({ NODE_ENV: "development", ACCESS_PASSWORD: undefined }, async () => {
    const ip = nextIp();
    for (let i = 0; i < FILES_PER_IP[0].max; i++) await proxy(post("/api/documents", ip));
    const over = await proxy(post("/api/documents", ip));
    assert.equal(over.status, 429);
    assert.match(await over.text(), /Слишком много файлов подряд/);
    // Запросы к ИИ с того же адреса лимит файлов не трогает.
    assert.equal((await proxy(post("/api/chat", ip))).status, 200);
  });
});

test("health-пробы открыты без входа и без пароля (P1)", async () => {
  // С паролем: без метки входа health всё равно доступен.
  await withEnv({ NODE_ENV: "production", ACCESS_PASSWORD: "секрет", OPEN_ACCESS: undefined }, async () => {
    assert.equal((await proxy(new NextRequest("http://localhost/api/health"))).status, 200);
    assert.equal((await proxy(new NextRequest("http://localhost/api/health/ready"))).status, 200);
  });
  // Без пароля на хостинге: остальные /api закрыты 503, health — нет.
  await withEnv({ NODE_ENV: "production", ACCESS_PASSWORD: undefined, OPEN_ACCESS: undefined }, async () => {
    assert.equal((await proxy(new NextRequest("http://localhost/api/health"))).status, 200);
    assert.notEqual((await proxy(new NextRequest("http://localhost/api/health/ready"))).status, 503);
  });
});
