// Поток ответа ассистента на границах: многобайтные буквы, склейка кусков, переводы строк Windows, очень длинный ответ — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readAnswer, streamEvents, type StreamEvent } from "./chat-stream.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const stream = (chunks: Uint8Array[]) => new Response(new ReadableStream({ start: (c) => (chunks.forEach((x) => c.enqueue(x)), c.close()) }));
const event = (delta: string) => `data: ${JSON.stringify({ type: "text-delta", delta })}\n\n`;

async function collect(res: Response): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of streamEvents(res)) out.push(e);
  return out;
}

test("русская буква разрезана посередине байтов между кусками потока — в ответе целая буква, а не «�»", async () => {
  const all = bytes(event("Обеспечение заявки — 1 % от НМЦК") + event(" «гарантия» ✓"));
  // Режем после каждого байта: каждый символ из двух и трёх байтов оказывается разрезанным.
  const answer = await readAnswer(stream(Array.from(all, (b) => Uint8Array.of(b))));
  assert.equal(answer, "Обеспечение заявки — 1 % от НМЦК «гарантия» ✓");
  assert.ok(!answer.includes("�"));
});

test("события с переводами строк Windows (\\r\\n) не теряются: ответ собирается целиком", async () => {
  // Часть прокси так пересылает поток. События не разделяются «по ходу», но ничего не пропадает.
  const text = event("Первая часть. ").replaceAll("\n", "\r\n") + event("Вторая часть.").replaceAll("\n", "\r\n") + "data: [DONE]\r\n\r\n";
  assert.equal(await readAnswer(stream([bytes(text)])), "Первая часть. Вторая часть.");
});

test("очень длинный ответ потоком по тысяче кусков собирается без потерь и быстро", async () => {
  const piece = "Участник обязан приложить копию лицензии. ";
  const chunks = Array.from({ length: 1000 }, () => bytes(event(piece.repeat(25))));
  const started = performance.now();
  const answer = await readAnswer(stream(chunks));
  assert.equal(answer.length, piece.length * 25 * 1000);
  assert.ok(performance.now() - started < 2000, "длинный ответ собирался слишком долго");
});

test("служебные строки, чужие события и мусор между событиями пропускаются; порядок текста сохраняется", async () => {
  const text = [": ping", "", 'event: x\ndata: {"type":"start"}', "", 'data: {"type":"text-delta","delta":"а"}', "", "data:", "", "data: не json", "", 'data: {"type":"text-delta","delta":"б"}', "", "data: [DONE]", ""].join("\n");
  assert.equal(await readAnswer(stream([bytes(text)])), "аб");
  assert.deepEqual((await collect(stream([bytes(text)]))).map((e) => e.type), ["start", "text-delta", "text-delta"]);
});

test("пустой ответ — пустая строка, а не исключение: решает тот, кто читает (чат говорит «ассистент не ответил»)", async () => {
  assert.equal(await readAnswer(stream([])), "");
  assert.equal(await readAnswer(stream([bytes("data: [DONE]\n\n")])), "");
  assert.equal(await readAnswer(new Response(null)), "");
});

test("ошибка внутри потока после части ответа — исключение с причиной, часть уже прочитанного не выдаётся за целый ответ", async () => {
  const res = stream([bytes(event("Начало ответа…")), bytes('data: {"type":"error","errorText":"Слишком много запросов к модели — повторите через минуту."}\n\n')]);
  await assert.rejects(readAnswer(res), /Слишком много запросов к модели/);
  await assert.rejects(readAnswer(stream([bytes('data: {"type":"error"}\n\n')])), /Ассистент не ответил/);
});
