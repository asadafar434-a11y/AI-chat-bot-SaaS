import "server-only";
import { execFile } from "node:child_process";

// Запасной путь для бесплатного поиска без ключа: часть поисковиков (Brave) отвечает «429» на запросы Node по «отпечатку» соединения, но пускает обычный curl.
// Вызывается только после отказа обычного запроса и только если curl есть на сервере; аргументы — массивом, без оболочки, адрес собран из закодированного запроса.
// Нет curl или он не ответил — обычная ошибка: поиск покажет отказ, как и без запасного пути.

const MARK = "\n__HTTP_STATUS__:";
const MAX_BYTES = 3_000_000;

type Init = { headers?: Record<string, string>; signal?: AbortSignal };

export async function curlFetch(url: string, init: Init = {}): Promise<Response> {
  if (!/^https:\/\/[^\s"'\\]+$/.test(url)) throw new Error("curl: адрес не подходит");
  const args = ["-sS", "-L", "--max-time", "12", "--compressed", "-w", `${MARK}%{http_code}`];
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    if (/[\r\n]/.test(name + value)) throw new Error("curl: заголовок не подходит");
    args.push("-H", `${name}: ${value}`);
  }
  args.push(url);
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile("curl", args, { maxBuffer: MAX_BYTES, timeout: 15_000, windowsHide: true, encoding: "utf8" }, (error, out) => (error ? reject(error) : resolve(out)));
    init.signal?.addEventListener("abort", () => child.kill(), { once: true });
  });
  const at = stdout.lastIndexOf(MARK);
  if (at < 0) throw new Error("curl: нет кода ответа");
  const status = Number(stdout.slice(at + MARK.length).trim());
  return new Response(stdout.slice(0, at), { status: Number.isFinite(status) && status > 0 ? status : 502, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
