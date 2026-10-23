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

// .7z делаем тем же 7-Zip (WebAssembly), которым читаем: так в тесте настоящие архивы, а не подделки.
async function make7z(files: Record<string, Uint8Array>, extra: string[] = []): Promise<Uint8Array> {
  const { default: SevenZip } = await import("7z-wasm");
  const sz = await SevenZip({ print() {}, printErr() {} });
  for (const [name, bytes] of Object.entries(files)) sz.FS.writeFile(`/${name}`, bytes);
  sz.callMain(["a", "/out.7z", ...Object.keys(files).map((n) => `/${n}`), ...extra]);
  return sz.FS.readFile("/out.7z");
}
const why = (failed: { name: string; reason: string }[], name: string) => failed.find((f) => f.name.endsWith(` → ${name}`) || f.name === name)?.reason ?? "";

test("архив в архиве в архиве не открывается, .rar пока не читается — в списке «не прочитано» сказано, почему", async () => {
  const deep = zipSync({ "глубоко.txt": strToU8("лишний файл") });
  const middle = zipSync({ "середина.txt": strToU8("средний файл"), "третий.zip": deep });
  const res = await send(zip({ "ДоЗ.txt": strToU8("Документация"), "второй.zip": middle, "старый.rar": strToU8("rar-данные") }));
  const { documents, failed } = await res.json();
  assert.deepEqual(documents.map((d: { name: string }) => d.name).sort(), ["ДоЗ.txt", "середина.txt"].sort());
  assert.match(why(failed, "третий.zip"), /глубже двух уровней/);
  assert.match(why(failed, "старый.rar"), /формат \.rar пока не читается/);
});

test(".7z читается: внутри .zip (как «Приложение №5 — Образцы форм.7z» у площадки) и отдельным файлом; имена по-русски, папки внутри не мешают", async () => {
  const seven = await make7z({ "Форма_Заверение об обстоятельствах.txt": strToU8("Заверяем, что обстоятельства отсутствуют"), "Форма_Сведения о цепочке собственников.txt": strToU8("Бенефициары: нет") });
  const inside = await send(zip({ "ДоЗ.txt": strToU8("Документация"), "Приложение №5 к ДоЗ - Образцы форм.7z": seven }));
  const a = await inside.json();
  assert.deepEqual(a.documents.map((d: { name: string }) => d.name).sort(), ["ДоЗ.txt", "Форма_Заверение об обстоятельствах.txt", "Форма_Сведения о цепочке собственников.txt"].sort());
  assert.match(a.documents.find((d: { name: string }) => /Заверение/.test(d.name)).text, /обстоятельства отсутствуют/);
  assert.equal(a.failed.length, 0);

  const alone = await send(new File([new Uint8Array(seven)], "образцы.7z"));
  const b = await alone.json();
  assert.equal(b.documents.length, 2, "отдельный .7z тоже раскладывается");
});

test(".7z с паролем, повреждённый и «не архив» — понятная причина, сервер не ждёт ввода пароля и не падает", async () => {
  const locked = await make7z({ "секрет.txt": strToU8("закрытый текст") }, ["-psecret", "-mhe=on"]);
  const res = await send(zip({ "ДоЗ.txt": strToU8("Документация"), "закрытый.7z": locked, "битый.7z": strToU8("это не архив 7z, а просто текст"), "полуфайл.7z": new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 1, 2, 3]) }));
  const { documents, failed } = await res.json();
  assert.deepEqual(documents.map((d: { name: string }) => d.name), ["ДоЗ.txt"]);
  for (const name of ["закрытый.7z", "битый.7z", "полуфайл.7z"]) assert.match(why(failed, name), /вложенный архив: архив повреждён или защищён паролем/, name);
});

test("«архивная бомба»: маленький .7z, который распаковался бы больше лимита, не открывается — память не тратится", async () => {
  // 130 МБ нулей сжимаются в сотни килобайт; предел распаковки — 120 МБ.
  const bomb = await make7z({ "нули.bin": new Uint8Array(130 * 1024 * 1024) }, ["-mx=1"]);
  assert.ok(bomb.length < 2 * 1024 * 1024, `архив должен быть маленьким, а он ${bomb.length}`);
  const res = await send(zip({ "ДоЗ.txt": strToU8("Документация"), "бомба.7z": bomb }));
  const { documents, failed } = await res.json();
  assert.deepEqual(documents.map((d: { name: string }) => d.name), ["ДоЗ.txt"]);
  assert.match(why(failed, "бомба.7z"), /слишком большой после распаковки/);
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
