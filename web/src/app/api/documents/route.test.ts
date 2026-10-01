// Приём файлов на сервере: битый запрос, слишком большой, слишком много файлов, частичный успех — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { c, docx, p as para, tbl, tr } from "../../../lib/docx-fixtures.ts";
import { MAX_FILES, MAX_REQUEST_BYTES } from "../../../lib/read-documents.ts";
import { POST } from "./route.ts";

const ENDPOINT = "http://localhost/api/documents";

function send(files: File[], fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(new Request(ENDPOINT, { method: "POST", body: form }));
}

const broken = (headers: Record<string, string> = {}) =>
  POST(
    new Request(ENDPOINT, {
      method: "POST",
      body: "--x\r\nобрывок",
      headers: { "content-type": "multipart/form-data; boundary=x", ...headers },
    })
  );

test("повреждённый запрос — 400, обрезанный прокси большой файл — 413 с понятной причиной", async () => {
  const bad = await broken();
  assert.equal(bad.status, 400);
  assert.equal(await bad.text(), "Запрос пришёл повреждённым — выберите файлы ещё раз.");

  const cut = await broken({ "content-length": String(MAX_REQUEST_BYTES + 1) });
  assert.equal(cut.status, 413);
  assert.match(await cut.text(), /^Файл не дошёл до сервера целиком: он больше 40 МБ/);
});

test("без файлов — 400, больше 20 файлов за раз — 413", async () => {
  assert.equal((await send([])).status, 400);
  const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => new File(["текст"], `${i}.txt`));
  const res = await send(many);
  assert.equal(res.status, 413);
  assert.equal(await res.text(), "За один раз — не больше 20 файлов.");
});

test("что прочиталось — в documents, что нет — в failed с причиной", async () => {
  const res = await send([
    new File(["Срок подачи заявок — 10 октября"], "Извещение.txt", { type: "text/plain" }),
    new File([], "пустой.txt"),
    new File(["не Word"], "старый.doc"),
    new File(["   \n  "], "пробелы.txt"),
  ]);
  assert.equal(res.status, 200);
  const { documents, failed } = await res.json();
  assert.equal(documents.length, 1);
  assert.equal(documents[0].name, "Извещение.txt");
  assert.equal(documents[0].text, "Срок подачи заявок — 10 октября");
  assert.equal(documents[0].chars, documents[0].text.length);
  assert.equal(documents[0].scan, undefined);
  assert.deepEqual(failed, [
    { name: "пустой.txt", reason: "файл пустой" },
    { name: "старый.doc", reason: "не похоже на файл Word — пересохраните его в .docx" },
    { name: "пробелы.txt", reason: "в файле нет текста" },
  ]);
});

test("распознавание выключено в браузере — фото в ИИ не уходит", async () => {
  const { documents, failed } = await (await send([new File([new Uint8Array(100)], "фото.jpg", { type: "image/jpeg" })], { ocr: "off" })).json();
  assert.equal(documents.length, 0);
  assert.match(failed[0].reason, /распознавание сканов выключено/);
});

test("Word с таблицей: в ответе карта — откуда в файле каждый кусок текста; у простого текста карты нет", async () => {
  const word = docx({ body: para("Техническое задание") + tbl(tr(c("Показатель"), c("Значение")), tr(c("Звук"), c("не менее 4 кВт"))) });
  const res = await send([new File([new Uint8Array(word)], "ТЗ.docx"), new File(["Простой текст"], "заметка.txt")]);
  const { documents } = await res.json();
  assert.equal(documents[0].name, "ТЗ.docx");
  assert.match(documents[0].text, /Звук \| не менее 4 кВт/);
  const cell = documents[0].map.spans.find((s: { from: number; to: number }) => documents[0].text.slice(s.from, s.to) === "не менее 4 кВт");
  assert.deepEqual({ table: cell.table, row: cell.row, col: cell.col }, { table: 1, row: 2, col: 2 });
  assert.equal(documents[1].map, undefined);
});
