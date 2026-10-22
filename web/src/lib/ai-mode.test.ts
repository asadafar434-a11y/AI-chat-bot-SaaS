// Переключатель «ИИ включён / выключен»: по умолчанию включён, выключенный не пускает ни один запрос к модели и не распознаёт сканы — npm test (без сети).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { AI_MODE_KEY, AI_OFF_MESSAGE, AiOffError, assertAiEnabled, readAiEnabled, saveAiEnabled } from "./ai-mode.ts";
import { aiHeaders } from "./purchase.ts";
import { readDocuments } from "./read-documents.ts";

const fakeStore = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
};

// Подмена браузерного хранилища для функций, которые читают window.localStorage сами.
function withBrowser<T>(store: ReturnType<typeof fakeStore>, run: () => T): T {
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = { localStorage: store, dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
  try {
    return run();
  } finally {
    g.window = before;
  }
}

afterEach(() => saveAiEnabled(true, fakeStore()));

test("по умолчанию ИИ включён: прежняя работа не меняется; выбор «выключен» запоминается", () => {
  const store = fakeStore();
  assert.equal(readAiEnabled(store), true);
  saveAiEnabled(false, store);
  assert.equal(store.data[AI_MODE_KEY], "off");
  assert.equal(readAiEnabled(store), false);
  saveAiEnabled(true, store);
  assert.equal(store.data[AI_MODE_KEY], "on");
  assert.equal(readAiEnabled(store), true);
});

test("хранилища нет или оно ломается: берётся выбор текущей страницы, иначе «включён»", () => {
  assert.equal(readAiEnabled(null), true);
  const broken = {
    getItem: () => {
      throw new Error("закрыто");
    },
    setItem: () => {
      throw new Error("закрыто");
    },
  };
  assert.equal(readAiEnabled(broken), true);
  saveAiEnabled(false, broken);
  assert.equal(readAiEnabled(broken), false, "выбор действует, пока открыта страница");
});

test("выключен — assertAiEnabled бросает AiOffError с понятным текстом; включён — ничего не делает", () => {
  assert.doesNotThrow(() => assertAiEnabled(fakeStore()));
  const off = fakeStore({ [AI_MODE_KEY]: "off" });
  assert.throws(() => assertAiEnabled(off), (e: unknown) => e instanceof AiOffError && e.message === AI_OFF_MESSAGE);
  assert.match(AI_OFF_MESSAGE, /переключатель «ИИ» в шапке меню/);
});

test("все запросы к модели идут через aiHeaders: ИИ выключен — запрос не уходит; включён — заголовки как прежде", () => {
  const on = fakeStore();
  assert.deepEqual(withBrowser(on, () => aiHeaders("p-1")), { "Content-Type": "application/json", "x-application-id": "p-1" });
  assert.deepEqual(withBrowser(on, () => aiHeaders()), { "Content-Type": "application/json" });
  const off = fakeStore({ [AI_MODE_KEY]: "off" });
  assert.throws(() => withBrowser(off, () => aiHeaders("p-1")), AiOffError);
});

test("распознавание сканов тоже под переключателем: ИИ выключен — на сервер уходит «ocr=off», включён — запрос как раньше", async () => {
  const sent: FormData[] = [];
  const send = async (_url: string, init: RequestInit) => {
    sent.push(init.body as FormData);
    return new Response(JSON.stringify({ documents: [{ name: "a.txt", text: "текст" }], failed: [] }), { status: 200 });
  };
  const file = new File(["текст"], "a.txt", { type: "text/plain" });
  const off = fakeStore({ [AI_MODE_KEY]: "off" });
  await withBrowser(off, () => readDocuments([file], send));
  assert.equal(sent[0].get("ocr"), "off");
  const on = fakeStore();
  await withBrowser(on, () => readDocuments([file], send));
  assert.equal(sent[1].get("ocr"), null, "включён — признака нет, сервер читает сканы как обычно");
});
