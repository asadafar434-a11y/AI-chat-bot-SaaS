// Все файлы заявки одним архивом: по порядку, ТП — без реквизитов участника, кривой запрос — понятный отказ — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import mammoth from "mammoth";
import { EMPTY_PROFILE, identityValues, type Profile } from "../../../../lib/profile.ts";
import { blankRequest } from "../../../../lib/blank-request.ts";
import { PLAIN_FORM } from "../../../../lib/tp.ts";
import { POST } from "./route.ts";

const PROFILE: Profile = { ...EMPTY_PROFILE, fullName: "ООО «Праздник»", shortName: "ООО «Праздник»", inn: "6612345676", signer: "Иванова А. П." };
const DRAFT = {
  subject: "Организация праздника",
  form: { ...PLAIN_FORM, hasPrice: true },
  goods: [],
  items: [{ clause: "2.1", requirement: "Звукорежиссёр на площадке", offer: "Обеспечим звукорежиссёра на всё время праздника" }],
  price: 450000,
};

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/tp/zip", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

test("архив: файлы по порядку частей, имя — по закупке, ТП без реквизитов участника", async () => {
  const res = await post({
    name: "Праздник: «День учителя» — заявка",
    files: [
      { part: "tp", ...DRAFT, profile: PROFILE },
      { part: "participant", ...DRAFT, profile: PROFILE },
      { part: "price", ...DRAFT, profile: PROFILE },
      { part: "tp", ...DRAFT },
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  assert.match(res.headers.get("content-disposition") ?? "", new RegExp(encodeURIComponent("Праздник «День учителя» — заявка.zip")));

  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const names = Object.keys(zip.files);
  assert.deepEqual(names, ["1. Техническое предложение.docx", "2. Анкета участника закупки.docx", "3. Предложение о цене договора.docx"]);

  const textOf = async (name: string) => (await mammoth.extractRawText({ buffer: await zip.file(name)!.async("nodebuffer") })).value;
  const tp = await textOf(names[0]);
  assert.match(tp, /Обеспечим звукорежиссёра/);
  for (const value of identityValues(PROFILE)) assert.ok(!tp.includes(value), `в ТП попало «${value}»`);
  assert.ok((await textOf(names[1])).includes(PROFILE.inn), "в анкете нет ИНН");
});

test("архив: бланк заказчика — отдельным файлом под своим названием", async () => {
  const blank = { source: "Извещение, приложение № 2", title: "Декларация участника закупки", pages: "стр. 25", fields: [{ label: "Наименование участника", value: "" }] };
  const res = await post({ name: "Заявка", files: [{ part: "tp", ...DRAFT }, blankRequest("Организация праздника", blank)] });
  assert.equal(res.status, 200);

  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const names = Object.keys(zip.files);
  assert.deepEqual(names, ["1. Техническое предложение.docx", "2. Декларация участника закупки.docx"]);
  const text = (await mammoth.extractRawText({ buffer: await zip.file(names[1])!.async("nodebuffer") })).value;
  assert.match(text, /Наименование участника/);
  assert.match(text, /стр\. 25/);
  assert.ok(!text.includes("ЗАЯВКА"));
});

test("архив: нет файлов, слишком много, часть без пунктов — отказ с понятным текстом", async () => {
  const noFiles = await post({ name: "Заявка", files: [] });
  assert.equal(noFiles.status, 400);
  assert.equal(await noFiles.text(), "Нет файлов для архива.");

  const tooMany = await post({ files: Array.from({ length: 31 }, () => ({ part: "tp", ...DRAFT })) });
  assert.equal(tooMany.status, 400);
  assert.match(await tooMany.text(), /не больше 30 файлов/);

  const empty = await post({ files: [{ part: "tp", subject: "Праздник", items: [] }] });
  assert.equal(empty.status, 400);
  assert.equal(await empty.text(), "В черновике нет пунктов для документа.");
});
