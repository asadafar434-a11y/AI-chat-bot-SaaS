// Сбои модели доходят до человека понятными словами: любой код ответа, обрыв соединения — без кусков JSON, английских
// сообщений и следов ошибки — npm test. Модель здесь поддельная (свой сервер на этом компьютере): платных запросов нет.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, mock, test } from "node:test";
import { readAnswer } from "../../lib/chat-stream.ts";
import { POST as chat } from "./chat/route.ts";
import { POST as check } from "./check/route.ts";
import { POST as requirements } from "./requirements/route.ts";
import { POST as tp } from "./tp/route.ts";

type Mode = { status: number; type: string; message: string } | "reset";

let server: Server;
let mode: Mode = { status: 500, type: "api_error", message: "boom" };
const saved = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL };

before(async () => {
  mock.method(console, "error", () => {});
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (mode === "reset") return req.socket.destroy();
      // x-should-retry: false — без повторов клиента модели, иначе каждая проверка ждала бы секунды.
      res.writeHead(mode.status, { "content-type": "application/json", "x-should-retry": "false" });
      res.end(JSON.stringify({ type: "error", error: { type: mode.type, message: mode.message } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  mock.restoreAll();
  await new Promise((resolve) => server.close(resolve));
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved.key;
  if (saved.url === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = saved.url;
});

const json = (request: object) => new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
const DOCS = [{ name: "Извещение.txt", text: "Извещение. Заявки принимаются до 20.10.2026 10:00 МСК. Предмет закупки — организация праздника." }];
const APPLICATION = [{ name: "Заявка.txt", text: "Предлагаем организовать праздник." }];

const ERRORS: Mode[] = [
  { status: 400, type: "invalid_request_error", message: "messages: text content blocks must be non-empty" },
  { status: 400, type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API" },
  { status: 401, type: "authentication_error", message: "invalid x-api-key" },
  { status: 403, type: "permission_error", message: "Request not allowed" },
  { status: 404, type: "not_found_error", message: "model: claude-x" },
  { status: 409, type: "conflict_error", message: "conflict" },
  { status: 413, type: "request_too_large", message: "Request exceeds the maximum allowed number of bytes." },
  { status: 422, type: "invalid_request_error", message: "unprocessable" },
  { status: 429, type: "rate_limit_error", message: "Number of requests has exceeded your per-minute rate limit" },
  { status: 500, type: "api_error", message: "Internal server error" },
  { status: 529, type: "overloaded_error", message: "Overloaded" },
];

// Понятно человеку: по-русски, коротко, без JSON, без следа ошибки и без английского текста модели.
function assertReadable(text: string, where: string) {
  assert.ok(/[А-Яа-яЁё]{4}/.test(text), `${where}: не по-русски — «${text.slice(0, 120)}»`);
  assert.ok(text.length > 15 && text.length < 400, `${where}: длина ${text.length}`);
  assert.doesNotMatch(text, /[{}<>]|\bat \w+|Error:|x-api-key|invalid_request|credit balance|Overloaded|conflict_error|stack/i, `${where}: «${text.slice(0, 120)}»`);
}

test("модель ответила ошибкой — разбор, ТП и проверка заявки отвечают понятным текстом, а не телом ответа модели", async () => {
  for (const error of ERRORS) {
    mode = error;
    const where = `${(error as { status: number }).status} ${(error as { type: string }).type}`;
    for (const [name, route, body] of [
      ["requirements", requirements, { documents: DOCS }],
      ["tp", tp, { documents: DOCS, samples: [] }],
      ["check", check, { documents: DOCS, application: APPLICATION }],
    ] as const) {
      const res = await route(json(body));
      assert.ok(res.status >= 400 && res.status < 600, `${where} ${name}: код ${res.status}`);
      assertReadable(await res.text(), `${where} ${name}`);
    }
  }
});

test("чат: ошибка модели приходит внутри потока событием error с понятным текстом", async () => {
  for (const error of ERRORS) {
    mode = error;
    const where = `${(error as { status: number }).status} ${(error as { type: string }).type}`;
    const res = await chat(json({ messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Какое обеспечение заявки?" }] }], documents: DOCS, general: false }));
    assert.equal(res.status, 200, "поток открывается, ошибка — внутри него");
    await assert.rejects(readAnswer(res), (e: Error) => (assertReadable(e.message, `${where} chat`), true));
  }
});

test("обрыв соединения с моделью — понятный текст, ничего не зависает", async () => {
  mode = "reset";
  const res = await requirements(json({ documents: DOCS }));
  assert.ok(res.status >= 500, `код ${res.status}`);
  assertReadable(await res.text(), "обрыв");
});

test("исчерпан месячный лимит расходов и пустой баланс — человеку «напишите владельцу», а не подробности счёта", async () => {
  for (const error of [
    { status: 429, type: "rate_limit_error", message: "You have reached your API usage limits (enforced_spend_limit_reached)" },
    { status: 400, type: "invalid_request_error", message: "You have reached your specified API usage limits." },
    { status: 400, type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API" },
  ] satisfies Mode[]) {
    mode = error;
    const text = await (await requirements(json({ documents: DOCS }))).text();
    assertReadable(text, error.message.slice(0, 30));
    assert.match(text, /Напишите (владельцу|ему)|владел/i);
    assert.doesNotMatch(text, /Billing|Console|ANTHROPIC_API_KEY|\.env|баланс в/);
  }
});
