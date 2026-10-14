// Охранник платных запросов: кого пускаем и что делаем, когда не удалось проверить вход — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { aiAuthDenial, type AiAuthState } from "./ai-auth.ts";

const base: AiAuthState = { sameOrigin: true, sessionRequired: true, session: "valid", production: true };
const with_ = (over: Partial<AiAuthState>) => ({ ...base, ...over });

test("вошедшего пускаем", () => {
  assert.equal(aiAuthDenial(base), null);
});

test("не вошёл — отказ 401; чужой сайт — отказ 401 даже у вошедшего", () => {
  assert.deepEqual(aiAuthDenial(with_({ session: "none" })), { status: 401, text: "Требуется вход" });
  assert.equal(aiAuthDenial(with_({ sameOrigin: false }))?.status, 401);
  assert.equal(aiAuthDenial(with_({ sameOrigin: false, sessionRequired: false }))?.status, 401, "без входа чужой сайт тоже не пускаем");
});

test("вход не требуется (AUTH_SECRET не задан) — пускаем с этого же сайта", () => {
  assert.equal(aiAuthDenial(with_({ sessionRequired: false, session: "none" })), null);
});

test("база не ответила: в боевом режиме — 503, охранник не открывается; на компьютере разработчика — пускаем", () => {
  assert.deepEqual(aiAuthDenial(with_({ session: "unavailable" })), {
    status: 503,
    text: "Сервис временно недоступен — попробуйте через минуту.",
  });
  assert.equal(aiAuthDenial(with_({ session: "unavailable", production: false })), null);
});
