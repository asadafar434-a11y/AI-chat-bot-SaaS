// Проверка «как на хостинге»: запускает настоящий сервер (next start) на свободном порту с паролем входа и смотрит, что
// у продукта один адрес. Запускать после сборки: `npm run build:host && npm run check:host`.
// Платных запросов к ИИ нет: ключ API для проверки отключён, а пароль каждый раз случайный и нигде не печатается.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const password = `check-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? "ок    " : "ОШИБКА"}  ${what}`);
  if (!ok) failed++;
};

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer().once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
let log = "";
const server = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"], {
  cwd: web,
  env: { ...process.env, NODE_ENV: "production", ACCESS_PASSWORD: password, ANTHROPIC_API_KEY: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => (log += chunk));
server.stderr.on("data", (chunk) => (log += chunk));
let exited = false;
server.once("exit", () => (exited = true));

const stop = () => {
  if (exited) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
};

const get = (url, cookie) => fetch(base + url, { redirect: "manual", headers: cookie ? { cookie } : {} });
const post = (url, body, cookie) =>
  fetch(base + url, { method: "POST", headers: { "content-type": "application/json", ...(cookie && { cookie }) }, body: JSON.stringify(body) });
const toLogin = (res) => res.status >= 300 && res.status < 400 && new URL(res.headers.get("location") ?? "", base).pathname === "/login";

try {
  // Сервер поднимается не сразу.
  const started = Date.now();
  for (;;) {
    if (exited) throw new Error(`Сервер не запустился:\n${log}`);
    try {
      if ((await get("/login")).status === 200) break;
    } catch {
      // ещё не слушает
    }
    if (Date.now() - started > 60_000) throw new Error(`Сервер не ответил за минуту:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  console.log(`Сервер на ${base}\n\nБез входа:`);
  check(toLogin(await get("/")), "главная страница ведёт на вход");
  check(toLogin(await get("/product/index.html")), "файлы экрана закрыты паролем");
  check((await get("/privacy")).status === 200, "политика открыта без пароля");
  check((await post("/api/tp/pdf", { part: "tp", items: [] })).status === 401, "запросы к серверу закрыты");

  console.log("\nВход:");
  const login = await post("/api/login", { password });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  check(login.status === 204 && cookie.startsWith("tl_access="), "верный пароль выдаёт метку входа");

  console.log("\nС входом:");
  const home = await get("/", cookie);
  const html = await home.text();
  check(home.status === 200 && (home.headers.get("content-type") ?? "").includes("text/html"), "главная страница открывается");
  check(html.includes('id="root"') && html.includes("/product/assets/"), "это экран продукта: есть #root и файлы из /product/assets/");
  check(/<title>Тендерный юрист<\/title>/.test(html), "заголовок страницы — «Тендерный юрист», без «прототип»");
  const csp = home.headers.get("content-security-policy") ?? "";
  check(csp.includes("default-src 'self'") && csp.includes("font-src 'self'"), "политика содержимого на месте");

  const files = [...html.matchAll(/(?:src|href)="(\/product\/[^"]+)"/g)].map((m) => m[1]);
  const script = files.find((f) => f.endsWith(".js"));
  const style = files.find((f) => f.endsWith(".css"));
  check(Boolean(script && style), "в странице есть скрипт и стили");
  let fonts = [];
  for (const file of [script, style].filter(Boolean)) {
    const res = await get(file, cookie);
    const type = res.headers.get("content-type") ?? "";
    check(res.status === 200 && /javascript|css/.test(type), `${file} отдаётся (${type})`);
    check((res.headers.get("cache-control") ?? "").includes("immutable"), `${file} браузер хранит, не перекачивая`);
    if (file === style) {
      const css = await res.text();
      check(!/googleapis|gstatic/.test(css), "стили не ходят за шрифтами на чужие сайты");
      check(!/url\(["']?data:font/.test(css), "шрифты не вшиты в стили (политика пускает их только файлами)");
      fonts = [...css.matchAll(/url\(["']?([^)"']+\.woff2)["']?\)/g)].map((m) => new URL(m[1], base + style).pathname);
    }
  }
  check(fonts.length >= 8, `шрифтов в стилях: ${fonts.length} (нужно 8 — Geist и Geist Mono, по 4 письменности)`);
  for (const font of fonts) {
    const res = await get(font, cookie);
    check(res.status === 200 && (res.headers.get("content-type") ?? "").includes("font/woff2"), `${font} отдаётся как шрифт`);
  }

  const pdf = await post("/api/tp/pdf", { part: "tp", subject: "Проверка сборки", items: [{ clause: "1", requirement: "Зал", offer: "Зал на [число] мест" }] }, cookie);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  check(pdf.status === 200 && bytes.subarray(0, 5).toString() === "%PDF-", "файл PDF собирается с того же адреса");
} catch (error) {
  failed++;
  console.error(String(error instanceof Error ? error.message : error));
} finally {
  stop();
}

console.log(failed ? `\nНе прошло проверок: ${failed}` : "\nВсё в порядке: у продукта один адрес.");
process.exit(failed ? 1 : 0);
