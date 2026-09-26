// Загрузка файлов: по одному на запрос, с пределами размера и числа — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileProblem, MAX_FILE_BYTES, MAX_FILES, readDocuments } from "./read-documents.ts";

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

// Сервер-заглушка: запоминает, сколько файлов пришло в каждом запросе.
function server(reply: (name: string) => Response) {
  const perRequest: number[] = [];
  const send = async (_url: string, init: RequestInit) => {
    const files = (init.body as FormData).getAll("files") as File[];
    perRequest.push(files.length);
    return reply(files[0].name);
  };
  return { send, perRequest };
}
const ok = (name: string) => Response.json({ documents: [{ id: name, name, chars: 5, text: `текст ${name}` }], failed: [] });

test("каждый файл — отдельным запросом, порядок сохраняется", async () => {
  const { send, perRequest } = server(ok);
  const { documents, failed } = await readDocuments([file("а.pdf"), file("б.pdf"), file("в.pdf"), file("г.pdf")], send);
  assert.deepEqual(perRequest, [1, 1, 1, 1]);
  assert.deepEqual(documents.map((d) => d.name), ["а.pdf", "б.pdf", "в.pdf", "г.pdf"]);
  assert.equal(failed.length, 0);
});

test("большой файл не уходит на сервер, остальные читаются", async () => {
  const { send, perRequest } = server(ok);
  const { documents, failed } = await readDocuments([file("скан.pdf", MAX_FILE_BYTES + 1), file("тз.docx")], send);
  assert.deepEqual(perRequest, [1]);
  assert.deepEqual(documents.map((d) => d.name), ["тз.docx"]);
  assert.match(failed[0].reason, /больше 40 МБ/);
});

test("сбой одного файла не роняет остальные; ответ сервера — в причине", async () => {
  const { send } = server((name) => (name === "плохой.pdf" ? new Response("Файл не дошёл до сервера целиком", { status: 413 }) : ok(name)));
  const { documents, failed } = await readDocuments([file("плохой.pdf"), file("хороший.pdf")], send);
  assert.deepEqual(documents.map((d) => d.name), ["хороший.pdf"]);
  assert.deepEqual(failed, [{ name: "плохой.pdf", reason: "Файл не дошёл до сервера целиком" }]);
});

test("ничего не прочиталось — ошибка с причинами", async () => {
  const { send } = server(() => new Response("", { status: 500 }));
  await assert.rejects(readDocuments([file("а.pdf")], send), /Не получилось прочитать: а\.pdf — сервер не смог прочитать файл/);
});

test("нет связи — понятная причина", async () => {
  const send = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(readDocuments([file("а.pdf")], send), /нет связи с сервером/);
});

test("слишком много файлов за раз", async () => {
  const { send } = server(ok);
  const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => file(`${i}.pdf`));
  await assert.rejects(readDocuments(many, send), /не больше 20 файлов/);
});

test("пределы файла", () => {
  assert.equal(fileProblem({ size: 1 }), null);
  assert.equal(fileProblem({ size: MAX_FILE_BYTES }), null);
  assert.match(fileProblem({ size: MAX_FILE_BYTES + 1 }) ?? "", /больше 40 МБ/);
  assert.equal(fileProblem({ size: 0 }), "файл пустой");
});
