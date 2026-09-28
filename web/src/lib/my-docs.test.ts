// Раскладка документов участника без ИИ — по названию файла и началу текста — и что человек узнаёт о причине — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { POST as profileRoute } from "../app/api/my-docs/profile/route.ts";
import { POST as sortRoute } from "../app/api/my-docs/sort/route.ts";
import { MY_DOCS_NO_KEY_TEXT } from "./claude-errors.ts";
import { OFFLINE_TEXT, sortDocuments } from "./me-store.ts";
import { DOC_KIND_KEYS, guessKinds, REQUISITE_KINDS } from "./my-docs.ts";

test("договоры с актами — опыт, дипломы и допуски — сотрудники", () => {
  assert.deepEqual(guessKinds("Контракт и акт — Учитель года 2025.pdf", "АКТ о приёмке оказанных услуг № 14"), ["experience"]);
  assert.deepEqual(guessKinds("Опыт.pdf", "Выписка из реестра контрактов: исполненные контракты участника"), ["experience"]);
  assert.deepEqual(guessKinds("Диплом режиссёра.pdf", "ДИПЛОМ о высшем образовании"), ["staff"]);
  assert.deepEqual(
    guessKinds("Удостоверение.pdf", "Удостоверение о проверке знаний правил работы в электроустановках, группа по электробезопасности IV"),
    ["staff"]
  );
  assert.deepEqual(guessKinds("Трудовой договор.docx", "ТРУДОВОЙ ДОГОВОР № 7 с работником"), ["staff"]);
});

test("документы заказчика и непонятное — «другое», реквизиты из договоров не берём", () => {
  assert.deepEqual(guessKinds("Проект контракта.pdf", "ПРОЕКТ КОНТРАКТА на оказание услуг"), ["other"]);
  assert.deepEqual(guessKinds("Протокол.pdf", "Протокол подведения итогов"), ["other"]);
  // В договоре рядом стоят реквизиты заказчика — из опыта реквизиты участника не заполняются.
  assert.equal(REQUISITE_KINDS.includes("experience"), false);
  assert.equal(REQUISITE_KINDS.includes("staff"), false);
  assert.deepEqual(DOC_KIND_KEYS.slice(-3), ["experience", "staff", "other"]);
});

// Без ключа ИИ и с подменённым fetch браузера — на время одного теста.
async function offline<T>(fake: typeof fetch, run: () => Promise<T>): Promise<T> {
  const [key, realFetch] = [process.env.ANTHROPIC_API_KEY, globalThis.fetch];
  delete process.env.ANTHROPIC_API_KEY;
  globalThis.fetch = fake;
  try {
    return await run();
  } finally {
    if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    globalThis.fetch = realFetch;
  }
}

const DIPLOMA = { name: "Диплом режиссёра.pdf", text: "ДИПЛОМ о высшем образовании" };
const post = (url: string, body: unknown, init?: RequestInit) =>
  new Request(new URL(url, "http://localhost"), { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, ...init });

test("ИИ не подключён: причина — «напишите владельцу», без подсказки про пример закупки", async () => {
  const toSortRoute: typeof fetch = (input, init) => sortRoute(post(String(input), {}, init));
  await offline(toSortRoute, async () => {
    for (const route of [sortRoute, profileRoute]) {
      const res = await route(post("/api/my-docs", { documents: [DIPLOMA] }));
      assert.equal(res.status, 503);
      const text = await res.text();
      assert.equal(text, MY_DOCS_NO_KEY_TEXT);
      assert.match(text, /^ИИ пока не подключён\. Напишите владельцу сервиса/);
      assert.doesNotMatch(text, /пример/);
    }
    // Браузер получает этот ответ и раскладывает сам — по названиям файлов.
    const { sorted, error } = await sortDocuments([DIPLOMA]);
    assert.equal(error, MY_DOCS_NO_KEY_TEXT);
    assert.deepEqual(sorted[0].kinds, ["staff"]);
  });
});

test("обрыв связи — по-русски, а не «Failed to fetch»", async () => {
  const noNetwork: typeof fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await offline(noNetwork, async () => {
    const { sorted, error } = await sortDocuments([DIPLOMA]);
    assert.equal(error, OFFLINE_TEXT);
    assert.deepEqual(sorted[0].kinds, ["staff"]);
  });
});
