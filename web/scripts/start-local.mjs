// Продукт на своём компьютере одним адресом — http://localhost:3000: экран, сервер, правовые страницы в одном процессе,
// как на хостинге (npm start). Собрать перед первым запуском и после правок: npm run build:host.
// Пароль на своём компьютере не нужен: OPEN_ACCESS=1 открывает работу без него, и только в этом запуске. Поэтому
// сервер слушает один этот компьютер (127.0.0.1), а не всю сеть. Порт — переменная PORT; по умолчанию 3000:
// на этом адресе в браузере лежат закупки и документы.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(path.join(web, "public", "product", "index.html")) || !existsSync(path.join(web, ".next", "BUILD_ID"))) {
  console.error("Продукт ещё не собран. Сначала выполните в папке web: npm run build:host");
  process.exit(1);
}

process.env.OPEN_ACCESS = "1";
const require = createRequire(import.meta.url);
process.argv.length = 2;
process.argv.push("start", "-p", process.env.PORT ?? "3000", "-H", "127.0.0.1");
require(require.resolve("next/dist/bin/next"));
