/**
 * TCP-прокси перед PostgreSQL для инъекции недоступности БД (тесты S8).
 *
 * Зачем прокси, а не остановка сервера: общая TEST PostgreSQL используется
 * параллельной работой (EIS). Прокси даёт клиенту честный `ECONNRESET`/отказ
 * соединения на время «отключения», не трогая сам сервер и других клиентов.
 *
 * `pause()` рвёт активные сокеты и отклоняет новые; `resume()` снова пускает.
 */

import { connect, createServer, type AddressInfo, type Socket } from "node:net";

export type PausableProxy = {
  port: number;
  url: (database: string) => string;
  pause: () => void;
  resume: () => void;
  close: () => Promise<void>;
};

export async function startPausableProxy(target: { host: string; port: number }): Promise<PausableProxy> {
  const sockets = new Set<Socket>();
  let paused = false;

  const server = createServer((client) => {
    if (paused) {
      client.destroy();
      return;
    }
    const upstream = connect(target.port, target.host);
    sockets.add(client);
    sockets.add(upstream);
    const cleanup = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("error", cleanup);
    upstream.on("error", cleanup);
    client.on("close", cleanup);
    upstream.on("close", cleanup);
    client.pipe(upstream);
    upstream.pipe(client);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    port,
    url: (database: string) => `postgresql://postgres:postgres@127.0.0.1:${port}/${database}`,
    pause() {
      paused = true;
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
    },
    resume() {
      paused = false;
    },
    close() {
      paused = true;
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
