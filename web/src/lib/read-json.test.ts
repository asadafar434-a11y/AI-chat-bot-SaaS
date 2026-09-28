// Кривой запрос к серверу — ответ 400 с понятным текстом, а не 500 без текста (аудит, п. 28) — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { POST as chat } from "../app/api/chat/route.ts";
import { POST as check } from "../app/api/check/route.ts";
import { POST as sortDocs } from "../app/api/my-docs/sort/route.ts";
import { POST as profileFromDocs } from "../app/api/my-docs/profile/route.ts";
import { POST as requirements } from "../app/api/requirements/route.ts";
import { POST as tp } from "../app/api/tp/route.ts";
import { POST as tpDocx } from "../app/api/tp/docx/route.ts";
import { POST as tpPart } from "../app/api/tp/part/route.ts";
import { BAD_REQUEST_TEXT, readJson, sentDocuments } from "./read-json.ts";

const request = (body: string) => new Request("http://localhost/api/x", { method: "POST", body, headers: { "content-type": "application/json" } });

test("тело запроса: не JSON, пустое, массив или строка — null", async () => {
  for (const body of ["{", "", "[]", '"текст"', "null", "42"]) assert.equal(await readJson(request(body)), null, JSON.stringify(body));
  assert.deepEqual(await readJson(request('{"documents":[]}')), { documents: [] });
});

test("документы из запроса: только записи с текстом, имя — строкой", () => {
  assert.deepEqual(sentDocuments("не список"), []);
  assert.deepEqual(
    sentDocuments([{ name: "ТЗ.docx", text: "Поставка бумаги", scan: true }, { name: 1, text: "Извещение" }, { name: "без текста" }, null, 7]),
    [
      { name: "ТЗ.docx", text: "Поставка бумаги", scan: true },
      { name: "", text: "Извещение" },
    ]
  );
});

test("маршруты ИИ и сборки Word на кривой JSON отвечают 400 с текстом", async () => {
  const routes = { chat, check, sortDocs, profileFromDocs, requirements, tp, tpDocx, tpPart };
  for (const [name, post] of Object.entries(routes)) {
    for (const body of ["{", "[1, 2]"]) {
      const res = await post(request(body));
      assert.equal(res.status, 400, `${name}: ${body}`);
      assert.equal(await res.text(), BAD_REQUEST_TEXT, name);
    }
  }
});

test("JSON без нужных полей — не 500: просим то, чего не хватает", async () => {
  const cases: [string, (r: Request) => Promise<Response>, string, RegExp][] = [
    ["chat", chat, '{"messages":"вопрос"}', /Нет вопроса для ответа/],
    ["requirements", requirements, '{"documents":{"text":1}}', /./],
    ["check", check, '{"documents":[{"text":"ТЗ"}],"application":"заявка"}', /./],
    ["tp/docx", tpDocx, '{"items":"пункт"}', /В черновике нет пунктов/],
  ];
  for (const [name, post, body, text] of cases) {
    const res = await post(request(body));
    assert.ok(res.status >= 400 && res.status < 500 || res.status === 503, `${name}: ${res.status}`);
    assert.match(await res.text(), text, name);
  }
});
