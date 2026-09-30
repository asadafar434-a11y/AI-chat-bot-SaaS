// Сборка для хостинга одной командой: `npm run build:host` (в папке web).
//   1. экран продукта (design-system/prototype) собирается в web/public/product;
//   2. собирается сервер (next build): он видит экран и отдаёт его с главной страницы (rewrites в next.config.ts).
// Дальше `npm start` — и продукт открывается одним адресом: экран, /api, вход по паролю, правовые страницы.
// Нужен весь репозиторий, а не только папка web: экран лежит рядом, в design-system/prototype.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(web, "..");
const screen = path.join(repo, "design-system", "prototype");

function run(cwd, command) {
  console.log(`\n> ${command}   [${path.relative(repo, cwd) || "."}]`);
  const { status } = spawnSync(command, { cwd, stdio: "inherit", shell: true });
  if (status !== 0) {
    console.error(`\nНе получилось: ${command}`);
    process.exit(status ?? 1);
  }
}

if (!existsSync(path.join(screen, "package.json"))) {
  console.error("Не нашёл экран продукта (design-system/prototype). На хостинг выкладывают весь репозиторий, а не только папку web.");
  process.exit(1);
}
if (!existsSync(path.join(screen, "node_modules"))) run(screen, "npm install --no-audit --no-fund");
run(screen, "npm run build:host");
if (!existsSync(path.join(web, "public", "product", "index.html"))) {
  console.error("Экран собрался, но web/public/product/index.html нет — проверьте design-system/prototype/vite.config.ts.");
  process.exit(1);
}
run(web, "npm run build");
console.log("\nГотово. Запуск: npm start (в папке web). Проверка: npm run check:host.");
