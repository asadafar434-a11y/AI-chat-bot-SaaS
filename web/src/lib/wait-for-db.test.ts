import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { databaseAddress, databaseAnswers, waitForDatabase } from "../../scripts/wait-for-db.mjs";

// Запуск продукта ждёт базу данных (23–26.10.2026: после включения компьютера база в Docker поднималась позже продукта, и вход заканчивался «На сервере что-то сломалось»).

const listen = (onConnection: (socket: net.Socket) => void) =>
  new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    const server = net.createServer(onConnection);
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((done) => server.close(() => done())) }));
  });

test("адрес базы из DATABASE_URL: хост и порт; порт по умолчанию 5432; не PostgreSQL и мусор — ждать нечего", () => {
  assert.deepEqual(databaseAddress("postgresql://user:secret@127.0.0.1:5433/tender?schema=public"), { host: "127.0.0.1", port: 5433 });
  assert.deepEqual(databaseAddress("postgres://localhost/tender"), { host: "localhost", port: 5432 });
  assert.equal(databaseAddress("file:./dev.db"), null);
  assert.equal(databaseAddress("не адрес"), null);
  assert.equal(databaseAddress(undefined), null);
});

test("настоящая база отвечает на запрос шифрования одним байтом — «готова»; порт без ответа, закрытая связь и пустой порт — «не готова»", async () => {
  const answered: Buffer[] = [];
  const db = await listen((s) => {
    s.once("data", (chunk) => {
      answered.push(chunk);
      s.write("S");
    });
  });
  assert.equal(await databaseAnswers({ host: "127.0.0.1", port: db.port }), true);
  assert.deepEqual([...answered[0]], [0, 0, 0, 8, 4, 210, 22, 47], "спрашиваем так, как это делает PostgreSQL-клиент, без пароля и имени");
  await db.close();

  // Молчит, но читает: иначе сервер не заметит, что клиент отключился, и закрыть его в конце теста не получится.
  const silent = await listen((s) => void s.resume());
  assert.equal(await databaseAnswers({ host: "127.0.0.1", port: silent.port }, 200), false, "порт открыт, а базы за ним нет (так держит порт Docker, пока база запускается)");
  await silent.close();

  const closing = await listen((s) => s.destroy());
  assert.equal(await databaseAnswers({ host: "127.0.0.1", port: closing.port }), false);
  await closing.close();

  const closed = await listen(() => undefined);
  const port = closed.port;
  await closed.close();
  assert.equal(await databaseAnswers({ host: "127.0.0.1", port }), false, "никто не слушает");
});

test("ожидание: база уже готова — молча; не готова — говорит об ожидании и продолжает, пока не ответит; адреса нет — не ждёт", async () => {
  const url = "postgresql://u:p@127.0.0.1:5432/db";
  const quiet: string[] = [];
  assert.equal(await waitForDatabase(url, { probe: async () => true, log: (m) => quiet.push(m) }), true);
  assert.deepEqual(quiet, []);

  let clock = 0;
  const said: string[] = [];
  const answers = [false, false, false, true];
  const ok = await waitForDatabase(url, { probe: async () => answers.shift()!, log: (m) => said.push(m), sleep: async (ms) => void (clock += ms), now: () => clock, intervalMs: 2000 });
  assert.equal(ok, true);
  assert.match(said[0], /Жду базу данных \(127\.0\.0\.1:5432\)… Если компьютер только включён, она запускается вместе с Docker/);
  assert.equal(said[1], "База данных ответила, запускаю продукт.");
  assert.equal(clock, 6000, "три ожидания по две секунды");

  let probes = 0;
  assert.equal(await waitForDatabase(undefined, { probe: async () => (probes++, false) }), true);
  assert.equal(probes, 0, "DATABASE_URL нет — базу не трогаем");
});

test("база не ответила за отведённое время — честно сказано, что вход и закупки на сервере не заработают, где включить; продукт при этом запускается (вернулось false, а не ошибка)", async () => {
  let clock = 0;
  const said: string[] = [];
  const ok = await waitForDatabase("postgresql://u:p@127.0.0.1:5432/db", { probe: async () => false, log: (m) => said.push(m), sleep: async (ms) => void (clock += ms), now: () => clock, timeoutMs: 10_000, intervalMs: 2000 });
  assert.equal(ok, false);
  assert.match(said[said.length - 1], /База данных \(127\.0\.0\.1:5432\) не ответила за 10 с\. Продукт запущен, но вход и закупки на сервере не заработают.*Docker Desktop/);
  assert.ok(!said.join("\n").includes("secret") && !said.join("\n").includes(":p@"), "пароль из адреса в сообщения не попадает");
});
