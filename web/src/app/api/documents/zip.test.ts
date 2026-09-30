// Архив с документами закупки: раскладывается на файлы, имена в DOS-кодировке читаются, лишнее пропускается — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { POST } from "./route.ts";

const send = (file: File) => {
  const form = new FormData();
  form.append("files", file);
  return POST(new Request("http://localhost/api/documents", { method: "POST", body: form }));
};
const zip = (entries: Record<string, Uint8Array>) => new File([new Uint8Array(zipSync(entries))], "закупка_docs.zip");

test("zip → каждый файл внутри читается как обычный; папки и вложенные архивы не мешают", async () => {
  const res = await send(
    zip({
      "папка/": new Uint8Array(),
      "папка/Извещение.txt": strToU8("Заявки принимаются до 20.10.2026"),
      "ТЗ.txt": strToU8("Бумага А4, 500 пачек"),
      "вложенный.zip": strToU8("PK"),
    })
  );
  assert.equal(res.status, 200);
  const { documents, failed } = await res.json();
  assert.deepEqual(documents.map((d: { name: string }) => d.name).sort(), ["Извещение.txt", "ТЗ.txt"]);
  assert.match(documents.find((d: { name: string }) => d.name === "ТЗ.txt").text, /Бумага А4/);
  assert.equal(failed.length, 1);
  assert.match(failed[0].reason, /вложенный архив/);
});

test("zip с именами в кодировке DOS (CP866) — имена читаются по-русски", async () => {
  // «Извещение.txt» в CP866: байты, записанные как latin1-символы — так их отдаёт старый архиватор.
  const cp866 = "\x88\xa7\xa2\xa5\xe9\xa5\xad\xa8\xa5.txt";
  const res = await send(zip({ [cp866]: strToU8("Срок подачи — 20 октября") }));
  const { documents } = await res.json();
  assert.deepEqual(documents.map((d: { name: string }) => d.name), ["Извещение.txt"]);
});

test("повреждённый архив и пустой архив — понятные причины, а не ошибка сервера", async () => {
  const broken = await send(new File([new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])], "битый.zip"));
  const { failed } = await broken.json();
  assert.match(failed[0].reason, /повреждён/);

  const empty = await send(zip({ "пусто/": new Uint8Array() }));
  assert.match((await empty.json()).failed[0].reason, /нет файлов/);
});
