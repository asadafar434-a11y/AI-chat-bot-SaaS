// Ждёт базу данных перед запуском продукта на своём компьютере (scripts/start-local.mjs).
// После включения компьютера Docker и база в нём поднимаются не сразу, а продукт — быстрее: без ожидания первый вход заканчивался
// сообщением «На сервере что-то сломалось». Настоящий ответ базы проверяем не по открытому порту (порт держит сам Docker, пока база внутри
// ещё запускается), а по рукопожатию PostgreSQL: любому подключению сервер отвечает одним байтом на запрос шифрования.
import net from "node:net";

// Запрос шифрования — первые восемь байт подключения к PostgreSQL; ответ «S» (можно) или «N» (нельзя) приходит от настоящей базы.
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]);

/** Адрес базы из DATABASE_URL; не PostgreSQL или адрес не разобрался — null (ждать нечего). */
export function databaseAddress(url) {
  try {
    const u = new URL(String(url));
    if (!/^postgres(?:ql)?:$/.test(u.protocol)) return null;
    return { host: u.hostname || "127.0.0.1", port: Number(u.port) || 5432 };
  } catch {
    return null;
  }
}

/** Отвечает ли по этому адресу настоящий PostgreSQL. */
export function databaseAnswers({ host, port }, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
    socket.once("connect", () => socket.write(SSL_REQUEST));
    socket.once("data", (chunk) => finish(chunk[0] === 0x53 || chunk[0] === 0x4e));
  });
}

/**
 * Ждёт, пока база ответит; возвращает true, если ответила (или ждать нечего), и false, если за отведённое время нет.
 * Продукт после этого всё равно стартует: без базы работает режим «в браузере», а в серверном режиме об этом сказано прямо.
 */
export async function waitForDatabase(url, options = {}) {
  const { timeoutMs = 120_000, intervalMs = 2000, log = console.log, probe = databaseAnswers, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = options;
  const address = databaseAddress(url);
  if (!address) return true;
  if (await probe(address)) return true;
  const where = `${address.host}:${address.port}`;
  log(`Жду базу данных (${where})… Если компьютер только включён, она запускается вместе с Docker — обычно до минуты.`);
  const until = now() + timeoutMs;
  while (now() < until) {
    await sleep(intervalMs);
    if (await probe(address)) {
      log("База данных ответила, запускаю продукт.");
      return true;
    }
  }
  log(`База данных (${where}) не ответила за ${Math.round(timeoutMs / 1000)} с. Продукт запущен, но вход и закупки на сервере не заработают, пока база не включена: откройте Docker Desktop и убедитесь, что контейнер с PostgreSQL запущен.`);
  return false;
}
