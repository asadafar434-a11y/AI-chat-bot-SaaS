// Сквозная проверка цепочки «файл → текст → запрос к модели → разбор ответа → сверка цитат» — npm test.
// Настоящий код сервера (чтение файлов, /api/requirements, /api/tp, /api/check) работает против поддельного
// сервера модели: он отвечает в том же потоковом формате, что и настоящий, и запоминает, что ему прислали.
// Платных запросов здесь нет. Что ответит живая модель, тест не проверяет — проверяется всё, что делает приложение.
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import ExcelJS from "exceljs";
import { readAnswer, streamEvents } from "../../lib/chat-stream.ts";
import { POST as chat } from "./chat/route.ts";
import { POST as check } from "./check/route.ts";
import { POST as documents } from "./documents/route.ts";
import { POST as facts } from "./my-docs/facts/route.ts";
import { POST as requirements } from "./requirements/route.ts";
import { POST as tp } from "./tp/route.ts";

type Seen = { system: string; blocks: { type: string; title?: string; text: string }[] };

let server: Server;
let reply = "";
let stop = "end_turn";
const seen: Seen[] = [];
const saved = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL };

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

before(async () => {
  server = createServer(async (req, res) => {
    const request = JSON.parse(await body(req));
    // Текст запроса бывает строкой (подбор статей закона) или блоками (документы, задание, вопрос).
    const first = request.messages[0].content as string | { type: string; title?: string; source?: { data: string }; text?: string }[];
    const content = typeof first === "string" ? [{ type: "text", text: first }] : first;
    seen.push({
      system: typeof request.system === "string" ? request.system : JSON.stringify(request.system),
      blocks: content.map((b) => ({ type: b.type, title: b.title, text: b.source?.data ?? b.text ?? "" })),
    });
    if (request.stream !== true) {
      // Подбор статей закона перед ответом чата — короткий запрос без потока: модель не выбрала ни одной статьи.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_pick",
          type: "message",
          role: "assistant",
          model: request.model,
          content: [{ type: "text", text: '{"articles":[]}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        })
      );
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      sse("message_start", {
        type: "message_start",
        message: { id: "msg_test", type: "message", role: "assistant", model: request.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
      })
    );
    res.write(sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    res.write(sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply } }));
    res.write(sse("content_block_stop", { type: "content_block_stop", index: 0 }));
    res.write(sse("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } }));
    res.end(sse("message_stop", { type: "message_stop" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved.key;
  if (saved.url === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = saved.url;
});

const json = (request: object) =>
  new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });

// Настоящий xlsx с техническим заданием: проверяем и чтение таблицы, и то, что её текст дошёл до модели.
async function specXlsx() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("ТЗ");
  sheet.addRow(["№", "Наименование", "Требование", "Кол-во"]);
  sheet.addRow([1, "Бумага офисная А4", "Плотность не менее 80 г/м²", 500]);
  sheet.addRow([2, "Картридж", "Совместимость с принтером HP LaserJet", 20]);
  return new File([new Uint8Array(await book.xlsx.writeBuffer())], "ТЗ.xlsx");
}

const NOTICE = "Извещение. Заявки принимаются до 20.10.2026 10:00 МСК. Участниками могут быть только субъекты малого предпринимательства.";

async function readSpec() {
  const form = new FormData();
  form.append("files", await specXlsx());
  const res = await documents(new Request("http://localhost/api/documents", { method: "POST", body: form }));
  assert.equal(res.status, 200);
  const { documents: docs, failed } = (await res.json()) as { documents: { name: string; text: string }[]; failed: unknown[] };
  assert.deepEqual(failed, []);
  return [{ name: "Извещение.txt", text: NOTICE }, ...docs.map(({ name, text }) => ({ name, text }))];
}

test("xlsx → требования: таблица дошла до модели, цитата из таблицы подтверждена, выдуманная — нет", async () => {
  const docs = await readSpec();
  assert.match(docs[1].text, /Бумага офисная А4 \| Плотность не менее 80 г\/м² \| 500/);

  reply = JSON.stringify({
    short: "Бумага и картриджи",
    subject: "Поставка бумаги и картриджей",
    kind: "44-ФЗ · запрос котировок",
    customer: "ГБУ Тест",
    price: "100 000 ₽",
    deadline: { date: "2026-10-20", time: "10:00", zone: "МСК" },
    who: [{ text: "Только малый бизнес", source: "Извещение", quote: "только субъекты малого предпринимательства" }],
    submit: [{ text: "Заявка", source: "Извещение", quote: "Заявки принимаются до 20.10.2026 10:00 МСК" }],
    scope: [
      { text: "Плотность бумаги не менее 80 г/м²", source: "ТЗ, п. 1", quote: "Плотность не менее 80 г/м²" },
      { text: "Гарантия 10 лет", source: "ТЗ, п. 9", quote: "Гарантия десять лет на всё" },
    ],
    terms: [],
    criteria: {
      howWins: "price",
      rows: [
        {
          criterion: "Цена контракта", criterionWeight: "100 %", indicator: "", indicatorWeight: "", detail: "", detailWeight: "",
          scoring: "Побеждает наименьшая цена", proof: "", form: "", source: "Извещение", quote: "Заявки принимаются до 20.10.2026 10:00 МСК",
        },
        {
          criterion: "Опыт", criterionWeight: "", indicator: "", indicatorWeight: "", detail: "", detailWeight: "",
          scoring: "—", proof: "", form: "", source: "Порядок оценки", quote: "Опыт не нужен никому и никогда",
        },
      ],
    },
  });
  seen.length = 0;
  const res = await requirements(json({ documents: docs }));
  assert.equal(res.status, 200, await res.clone().text());
  const out = await res.json();

  // Модель получила оба документа целиком, отдельными блоками, а не пересказ.
  assert.deepEqual(seen[0].blocks.filter((b) => b.type === "document").map((b) => b.title), ["Извещение.txt", "ТЗ.xlsx"]);
  assert.match(seen[0].blocks.find((b) => b.title === "ТЗ.xlsx")!.text, /Картридж \| Совместимость с принтером HP LaserJet \| 20/);

  assert.equal(out.groups.scope[0].verified, true);
  assert.equal(out.groups.scope[1].verified, false, "цитата, которой нет в документах, не должна считаться подтверждённой");
  assert.equal(out.groups.who[0].verified, true);
  assert.equal(out.deadline.date, "2026-10-20");
  assert.equal(out.criteria.howWins, "price");
  assert.deepEqual(out.criteria.rows.map((r: { verified: boolean }) => r.verified), [true, false], "цитаты критериев тоже сверяются");
});

test("требования со всеми полями: числа и срок проверены по цитате, «не менее» — из документа, а не со слов модели", async () => {
  const docs = await readSpec();
  const row = (over: object) => ({
    text: "", source: "ТЗ", quote: "", mandatory: "required", type: "service", deadline: "", numbers: [], check: "", evidence: [], ...over,
  });
  reply = JSON.stringify({
    short: "Бумага", subject: "Бумага", kind: "44-ФЗ · запрос котировок", customer: "ГБУ Тест", price: "100 000 ₽",
    deadline: { date: "2026-10-20", time: "10:00", zone: "МСК" },
    who: [],
    submit: [
      row({ text: "Заявка", type: "product", quote: "Заявки принимаются до 20.10.2026 10:00 МСК", deadline: "до 20.10.2026 10:00 МСК", mandatory: "technical" }),
    ],
    scope: [
      row({
        text: "Плотность бумаги не менее 80 г/м²", quote: "Плотность не менее 80 г/м²", type: "product",
        // Модель ошиблась: написала 8 вместо 80 и перепутала границу.
        numbers: [{ what: "плотность", op: "max", value: 8, value2: 0, unit: "г/м²", raw: "не более 8 г/м²" }],
        check: "названа марка бумаги", evidence: ["сертификат", "сертификат"],
      }),
    ],
    terms: [row({ text: "Подать до 25 октября", type: "deadline", quote: "Заявки принимаются до 20.10.2026 10:00 МСК", deadline: "до 25.10.2026" })],
    criteria: { howWins: "price", rows: [] },
  });
  const res = await requirements(json({ documents: docs }));
  assert.equal(res.status, 200, await res.clone().text());
  const out = await res.json();

  // Тип по группе, обязательность не из списка — «не указано».
  assert.deepEqual([out.groups.submit[0].type, out.groups.submit[0].mandatory], ["document", "unclear"]);
  assert.equal(out.groups.submit[0].deadline, "до 20.10.2026 10:00 МСК");

  const paper = out.groups.scope[0];
  assert.deepEqual(paper.numbers.map((c: { what: string; op: string; value: number; unit: string }) => [c.op, c.value, c.unit]), [["min", 80, "г/м²"]], "граница — из документа");
  assert.equal(paper.numbers[0].what, "", "название от модели берётся, только если её число совпало с документом");
  assert.match(paper.issues.join(" "), /не найдено в цитате/);
  assert.deepEqual(paper.evidence, ["сертификат"]);
  assert.equal(paper.check, "названа марка бумаги");

  // Срок, которого нет в цитате, не принимается; число из пересказа, которого нет в цитате, помечается.
  assert.equal(out.groups.terms[0].deadline, "");
  assert.match(out.groups.terms[0].issues.join(" "), /срок «до 25\.10\.2026» не найден в цитате/);
  assert.match(out.groups.terms[0].issues.join(" "), /число 25/);
});

test("старый формат ответа без новых полей принимается: поля заполняются как «не указано», платной попытки исправления нет", async () => {
  const docs = await readSpec();
  reply = JSON.stringify({
    short: "Бумага", subject: "", kind: "", customer: "", price: "", deadline: { date: "", time: "", zone: "" },
    who: [], submit: [], scope: [{ text: "Плотность не менее 80 г/м²", source: "ТЗ", quote: "Плотность не менее 80 г/м²" }], terms: [],
    criteria: { howWins: "unknown", rows: [] },
  });
  seen.length = 0;
  const res = await requirements(json({ documents: docs }));
  assert.equal(res.status, 200, await res.clone().text());
  const out = await res.json();
  assert.equal(seen.length, 1, "модель не просили исправлять ответ");
  assert.deepEqual([out.groups.scope[0].mandatory, out.groups.scope[0].type], ["unclear", "other"]);
  assert.deepEqual(out.groups.scope[0].numbers.map((c: { value: number }) => c.value), [80], "числа из цитаты код находит сам");
});

test("ответ модели не по схеме: одна попытка исправления, потом понятная ошибка", async () => {
  const docs = await readSpec();
  reply = "это не JSON";
  seen.length = 0;
  const res = await requirements(json({ documents: docs }));
  assert.equal(res.status, 422);
  assert.match(await res.text(), /Не удалось разобрать ответ модели/);
  assert.equal(seen.length, 2, "второй запрос — с просьбой исправить ответ");
});

test("обрезанный ответ и отказ модели — понятные ошибки, а не пустой результат", async () => {
  const docs = await readSpec();
  reply = "{";
  stop = "max_tokens";
  assert.equal((await requirements(json({ documents: docs }))).status, 422);
  stop = "refusal";
  const refused = await requirements(json({ documents: docs }));
  assert.equal(refused.status, 422);
  assert.match(await refused.text(), /отказалась/);
  stop = "end_turn";
});

test("техпредложение: образцы участника уходят модели после документов, цитаты сверяются с ТЗ", async () => {
  const docs = await readSpec();
  reply = JSON.stringify({
    form: { title: "Техническое предложение", source: "", participantFields: [], consent: "", hasPrice: false, priceNote: "", smeDeclaration: "" },
    goods: [
      {
        name: "Бумага офисная А4",
        characteristics: "Плотность 80 г/м², марка [марка бумаги]",
        quantity: "500",
        source: "ТЗ, п. 1",
        quote: "Плотность не менее 80 г/м²",
      },
    ],
    items: [],
    antiDumping: { rule: "", quote: "" },
    cast: { clause: "", requirement: "", quote: "", groups: [], replace: { rule: "", source: "", quote: "" } },
  });
  seen.length = 0;
  const res = await tp(json({ documents: docs, samples: [{ name: "Мой прошлый ТП.docx", text: "Предлагаем бумагу Снегурочка" }] }));
  assert.equal(res.status, 200, await res.clone().text());
  const out = await res.json();
  assert.equal(out.goods[0].verified, true);
  assert.match(out.goods[0].characteristics, /\[марка бумаги\]/, "что модель не знает, остаётся полем «[…]»");
  // Заказчик: «плотность не менее 80», модель написала «80» — это граница заказчика, а не значение участника.
  assert.equal(out.goods[0].characteristics, "Плотность [число, не меньше 80] г/м², марка [марка бумаги]");

  const titles = seen[0].blocks.filter((b) => b.type === "document").map((b) => b.title);
  assert.deepEqual(titles, ["Извещение.txt", "ТЗ.xlsx", "Образец участника: Мой прошлый ТП.docx"]);
});

test("проверка заявки: цитата требования ищется в закупке, цитата ошибки — в заявке; ошибки идут раньше замечаний", async () => {
  const docs = await readSpec();
  const application = [{ name: "Заявка", text: "Бумага плотностью 70 г/м², картридж HP" }];
  reply = JSON.stringify({
    findings: [
      { kind: "warn", what: "Нет марки", todo: "Укажите марку", source: "ТЗ", quote: "Картридж", inApplication: "" },
      {
        kind: "bad",
        what: "Плотность меньше требуемой",
        todo: "Укажите бумагу от 80 г/м²",
        source: "ТЗ, п. 1",
        quote: "Плотность не менее 80 г/м²",
        inApplication: "Бумага плотностью 70 г/м²",
      },
      { kind: "bad", what: "Выдуманная ошибка", todo: "—", source: "ТЗ", quote: "Такого в ТЗ нет", inApplication: "И в заявке нет" },
    ],
    okCount: 4,
  });
  seen.length = 0;
  const res = await check(json({ documents: docs, application }));
  assert.equal(res.status, 200);
  const out = await res.json();

  assert.deepEqual(out.findings.map((f: { kind: string }) => f.kind), ["bad", "bad", "warn"]);
  assert.deepEqual([out.findings[0].verified, out.findings[0].appVerified], [true, true]);
  assert.deepEqual([out.findings[1].verified, out.findings[1].appVerified], [false, false], "выдуманные цитаты помечаются");
  assert.equal(out.okCount, 4);
  assert.match(seen[0].blocks.at(-2)!.title ?? "", /Заявка участника: Заявка/);
});

test("база доказательств: факты из документов компании проверяются по тексту — выдуманное убирается, источник и документ остаются", async () => {
  const license = "ЛИЦЕНЗИЯ № Л035-00115-77/00123456. Лицензия предоставлена на осуществление образовательной деятельности. Лицензия действительна до 12.05.2027.";
  const found = (over: object) => ({
    kind: "license", title: "Лицензия на образовательную деятельность № Л035-00115-77/00123456", fields: [{ key: "number", value: "Л035-00115-77/00123456" }],
    measures: [], validFrom: "", validUntil: "2027-05-12", perpetual: false, source: "Лицензия.pdf", quote: "Лицензия действительна до 12.05.2027", ...over,
  });
  reply = JSON.stringify({
    facts: [
      found({}),
      found({ title: "Лицензия на медицинскую деятельность", quote: "Лицензия на медицинскую деятельность действительна бессрочно" }),
      found({ kind: "certificate", title: "Сертификат ISO 9001", quote: "Сертификат ISO 9001 действителен до 01.01.2030", validUntil: "2030-01-01" }),
    ],
  });
  seen.length = 0;
  const res = await facts(json({ documents: [{ id: "doc-1", name: "Лицензия.pdf", text: license }, { id: "doc-2", name: "Пустой.pdf", text: "  " }] }));
  assert.equal(res.status, 200, await res.clone().text());
  const out = await res.json();
  // Модель увидела документ целиком отдельным блоком и задание с видами фактов.
  assert.deepEqual(seen[0].blocks.filter((b) => b.type === "document").map((b) => b.title), ["Лицензия.pdf"]);
  assert.match(seen[0].blocks.at(-1)!.text, /Виды фактов:/);
  // Прошёл только факт, чья цитата стоит в документе; выдуманные убраны, и об этом сказано.
  assert.equal(out.facts.length, 1);
  assert.equal(out.dropped, 2);
  assert.deepEqual(out.facts[0].source, { type: "document", docId: "doc-1", docName: "Лицензия.pdf", quote: "Лицензия действительна до 12.05.2027" });
  assert.deepEqual([out.facts[0].fields, out.facts[0].validity], [{ number: "Л035-00115-77/00123456" }, { until: "2027-05-12" }]);
  assert.equal(out.issues.length, 2);

  // Нет документов с текстом — понятный отказ без обращения к модели.
  seen.length = 0;
  assert.equal((await facts(json({ documents: [{ id: "x", name: "Пустой.pdf", text: "" }] }))).status, 400);
  assert.equal(seen.length, 0);
});

test("без ключа ИИ сервер честно отвечает 503 и не ходит к модели", async () => {
  const docs = await readSpec();
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  seen.length = 0;
  try {
    for (const route of [requirements, tp, facts]) assert.equal((await route(json({ documents: docs }))).status, 503);
    assert.equal((await check(json({ documents: docs, application: [{ name: "a", text: "b" }] }))).status, 503);
  } finally {
    process.env.ANTHROPIC_API_KEY = key;
  }
  assert.equal(seen.length, 0);
});

test("чат: ответ модели приходит потоком и собирается целиком, документы закупки и вопрос уходят модели", async () => {
  reply = "Обеспечение заявки — **1 %** от начальной цены (п. 7 извещения).";
  stop = "end_turn";
  seen.length = 0;
  const res = await chat(
    json({
      messages: [{ id: "q1", role: "user", parts: [{ type: "text", text: "Какое обеспечение заявки?" }], metadata: { date: "30.09.2026" } }],
      documents: [{ name: "Извещение.txt", text: NOTICE }],
    })
  );
  assert.equal(res.status, 200, await res.clone().text());
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

  const events: string[] = [];
  let answer = "";
  for await (const event of streamEvents(res.clone())) {
    events.push(event.type);
    if (event.type === "text-delta") answer += event.delta;
  }
  assert.deepEqual([events[0], events.at(-1)], ["start", "finish"], "поток начинается и заканчивается служебными событиями");
  assert.equal(answer, reply);
  assert.equal(await readAnswer(res), reply, "readAnswer склеивает тот же текст");

  // Главный запрос к модели — последний: перед ним уходит только подбор статей закона.
  const main = seen.at(-1)!;
  assert.deepEqual(main.blocks.filter((b) => b.type === "document").map((b) => b.title), ["Извещение.txt"]);
  assert.match(main.blocks.at(-1)!.text, /Какое обеспечение заявки\?/);
  assert.match(main.blocks.at(-1)!.text, /Дата вопроса: 30\.09\.2026/);
});

test("разбор потока: склеенные и оборванные куски, лишние строки и сбой сервера внутри потока", async () => {
  const stream = (chunks: string[]) =>
    new Response(new ReadableStream({ start: (c) => (chunks.forEach((x) => c.enqueue(new TextEncoder().encode(x))), c.close()) }));
  // Событие разрезано посередине, между событиями — служебная строка, в конце — [DONE].
  const cut = stream(['data: {"type":"text-delta","delta":"Обеспечение ', 'заявки"}\n\n: ping\n\ndata: {"type":"text-delta","delta":" — 1 %"}\n\ndata: [DONE]\n\n']);
  assert.equal(await readAnswer(cut), "Обеспечение заявки — 1 %");
  // Последнее событие — без завершающей пустой строки; строка не по формату пропускается.
  assert.equal(await readAnswer(stream(['data: не json\n\ndata: {"type":"text-delta","delta":"конец"}'])), "конец");
  // Сбой на стороне сервера приходит событием error — и становится исключением с причиной.
  await assert.rejects(readAnswer(stream(['data: {"type":"error","errorText":"Лимит запросов исчерпан"}\n\n'])), /Лимит запросов исчерпан/);
});
