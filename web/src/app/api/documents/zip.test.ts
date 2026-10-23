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

test("архив в архиве: приложения внутри вложенного zip читаются как обычные файлы (так отдаёт площадка «Приложение №1 — Технические требования»)", async () => {
  const inner = zipSync({ "Приложение №1 — Технические требования.txt": strToU8("Сварочный агрегат МАКС-300, 1 шт."), "Таблица 1.1.txt": strToU8("Сварочный агрегат МАКС-500, 2 шт.") });
  const res = await send(zip({ "ДоЗ.txt": strToU8("Документация о закупке"), "Приложение №1 к ДоЗ.zip": inner }));
  const { documents, failed } = await res.json();
  assert.deepEqual(documents.map((d: { name: string }) => d.name).sort(), ["Таблица 1.1.txt", "ДоЗ.txt", "Приложение №1 — Технические требования.txt"].sort());
  assert.match(documents.find((d: { name: string }) => d.name === "Таблица 1.1.txt").text, /МАКС-500/);
  assert.equal(failed.length, 0);
});

test("архив в архиве в архиве и форматы .7z/.rar не читаются — и в списке «не прочитано» сказано, почему", async () => {
  const deep = zipSync({ "глубоко.txt": strToU8("лишний файл") });
  const middle = zipSync({ "середина.txt": strToU8("средний файл"), "третий.zip": deep });
  const res = await send(zip({ "ДоЗ.txt": strToU8("Документация"), "второй.zip": middle, "Приложение №5.7z": strToU8("7z-данные"), "старый.rar": strToU8("rar-данные") }));
  const { documents, failed } = await res.json();
  assert.deepEqual(documents.map((d: { name: string }) => d.name).sort(), ["ДоЗ.txt", "середина.txt"].sort());
  const why = (name: string) => failed.find((f: { name: string }) => f.name.endsWith(` → ${name}`))?.reason ?? "";
  assert.match(why("третий.zip"), /глубже двух уровней/);
  assert.match(why("Приложение №5.7z"), /формат \.7z пока не читается/);
  assert.match(why("старый.rar"), /формат \.rar пока не читается/);
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
