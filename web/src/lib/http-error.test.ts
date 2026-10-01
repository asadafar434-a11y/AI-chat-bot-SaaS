// Тексты ошибок запросов: при любом сбое человек видит понятную фразу, а не страницу хостинга и не «Failed to fetch» — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { errorMessage, errorText, OFFLINE_TEXT, TIMEOUT_TEXT } from "./http-error.ts";

const answer = (status: number, body: string, type = "text/plain; charset=utf-8") => new Response(body, { status, headers: { "content-type": type } });

const NGINX_PAGE = "<html>\r\n<head><title>504 Gateway Time-out</title></head>\r\n<body>\r\n<center><h1>504 Gateway Time-out</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>";
const NEXT_PAGE = '<!DOCTYPE html><html lang="en"><head><title>404: This page could not be found.</title></head><body><div>404</div></body></html>';
const STATUSES = [400, 401, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504];

test("свой текст сервера показываем как есть: вход, лимиты, ИИ не подключён", async () => {
  for (const [status, text] of [
    [401, "Нужно снова войти по паролю — обновите страницу."],
    [429, "Слишком много запросов к ИИ подряд — продолжите через 3 мин."],
    [503, "ИИ пока не подключён. Напишите владельцу сервиса: контакты на странице «Контакты»."],
    [400, "В черновике нет пунктов для документа."],
  ] as const) {
    assert.equal(await errorText(answer(status, `${text}\n`), "запасная"), text);
  }
});

test("страница ошибки хостинга, JSON, пустой и слишком длинный ответ — понятной фразой по коду, при любом коде ответа", async () => {
  const bodies = [
    ["страница nginx", NGINX_PAGE, "text/html"],
    ["страница Next.js", NEXT_PAGE, "text/html; charset=utf-8"],
    ["страница без заголовка типа", NGINX_PAGE, "text/plain"],
    ["JSON", '{"error":{"message":"upstream timeout","code":504}}', "application/json"],
    ["JSON без заголовка типа", '{"error":"x"}', "text/plain"],
    ["пустой ответ", "", "text/plain"],
    ["след ошибки", "Error: boom\n    at foo (/app/x.js:1:1)\n".repeat(40), "text/plain"],
  ] as const;
  for (const status of STATUSES) {
    for (const [what, body, type] of bodies) {
      const text = await errorText(answer(status, body, type), "запасная");
      assert.ok(!/[<>{}]/.test(text) && text.length < 200, `${status}, ${what}: «${text.slice(0, 80)}»`);
      assert.notEqual(text, "запасная", `${status}, ${what}: для этого кода есть своя фраза`);
    }
  }
});

test("код не из списка — запасная фраза вызывающего; каждая фраза по коду объясняет, что делать", async () => {
  assert.equal(await errorText(answer(418, NGINX_PAGE, "text/html"), "Не удалось составить документ."), "Не удалось составить документ.");
  for (const status of STATUSES) {
    const text = await errorText(answer(status, ""), "запасная");
    assert.match(text, /обновите|повторите|подождите|отправляйте|проверьте|напишите/i, `${status}: ${text}`);
  }
});

test("нет сети и таймаут: понятная фраза, а не английский текст браузера; своё сообщение — как есть", () => {
  for (const message of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "fetch failed", "Network request failed"]) {
    assert.equal(errorMessage(new TypeError(message)), OFFLINE_TEXT, message);
  }
  // Ошибка самой программы — не «нет связи»: прятать её за этим нельзя, но и показывать по-английски незачем.
  const bug = errorMessage(new TypeError("Cannot read properties of undefined (reading 'text')"));
  assert.doesNotMatch(bug, /Cannot|undefined/);
  assert.notEqual(bug, OFFLINE_TEXT);
  assert.equal(errorMessage(new DOMException("signal timed out", "TimeoutError")), TIMEOUT_TEXT);
  assert.equal(errorMessage(new Error("Слишком много запросов подряд — подождите минуту и повторите.")), "Слишком много запросов подряд — подождите минуту и повторите.");
  assert.equal(errorMessage("строка", "запасная"), "запасная");
  assert.equal(errorMessage(undefined), "Не получилось — обновите страницу и повторите.");
});
