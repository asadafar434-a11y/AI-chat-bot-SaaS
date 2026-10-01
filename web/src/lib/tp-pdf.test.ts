// Файлы PDF заявки: тот же текст, что в Word, жёлтые места остаются жёлтыми, ТП — без реквизитов участника — npm test.
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { test } from "node:test";
import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { POST as pdf } from "../app/api/tp/pdf/route.ts";
import { POST as zip } from "../app/api/tp/zip/route.ts";
import { identityValues } from "./profile.ts";
import { buildPartDocx, buildTpDocx } from "./tp-docx.ts";
import { DATA, DOC, FILLED, PARTS, PROFILE } from "./tp-fixtures.ts";
import { buildPartPdf, buildTpPdf } from "./tp-pdf.ts";
import { PART_TITLES } from "./tp-parts.ts";

async function pdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    // Служебные строки вида «-- 1 of 2 --» — не текст документа.
    return (await parser.getText()).text.replace(/^-- \d+ of \d+ --$/gm, "");
  } finally {
    await parser.destroy();
  }
}

const docxText = async (buffer: Buffer) => (await mammoth.extractRawText({ buffer })).value;

// Слова документа без учёта переносов строк и порядка ячеек: по ним видно, что в двух форматах одно и то же.
const words = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).sort();

// Жёлтый цвет заливки (1 1 0) в содержимом страниц: так pdfmake рисует подсветку слов.
function yellowMarks(buffer: Buffer): number {
  const raw = buffer.toString("latin1");
  let count = 0;
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      const content = inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
      count += (content.match(/1 1 0 scn/g) ?? []).length;
    } catch {
      // Поток не сжат или это шрифт — содержимого страницы в нём нет.
    }
  }
  return count;
}

test("PDF каждой части заявки собирается, русский текст читается, файл настоящий", async () => {
  for (const part of PARTS) {
    const buffer = await buildTpPdf(part, DATA);
    assert.equal(buffer.subarray(0, 5).toString(), "%PDF-", part);
    // Длинное название переносится на вторую строку — сравниваем без учёта переносов.
    const text = (await pdfText(buffer)).replace(/\s+/g, " ");
    assert.ok(text.includes(PART_TITLES[part]), `${part}: нет заголовка`);
    assert.match(text, /Организация церемонии «Педагог года»/, part);
  }
  const tp = await pdfText(await buildTpPdf("tp", DATA));
  for (const expected of ["Моноблок 23,8", "Процессор Intel Core i5", "Зал не менее 150 мест", "Соколова Мария Андреевна", "Состав исполнителей (п. 3.5 ТЗ)"]) {
    assert.ok(tp.includes(expected), `в ТП нет «${expected}»`);
  }
});

test("слова в PDF и в Word совпадают по каждой части заявки — файлы разных форматов не расходятся", async () => {
  for (const variant of [DATA, { ...DATA, goods: [], cast: null, price: null, profile: null, subject: "" }]) {
    for (const part of PARTS) {
      const fromPdf = words(await pdfText(await buildTpPdf(part, variant)));
      const fromDocx = words(await docxText(await buildTpDocx(part, variant)));
      assert.deepEqual(fromPdf, fromDocx, `${part}: текст в PDF и в Word разный`);
    }
  }
  // Готовый документ, который написал ИИ: заголовок, абзацы, строки и таблица.
  assert.deepEqual(words(await pdfText(await buildPartPdf(DOC))), words(await docxText(await buildPartDocx(DOC))));
});

test("жёлтые места «[…]» остаются жёлтыми и в PDF; когда всё вписано — подсветки нет", async () => {
  const open = await buildTpPdf("tp", DATA);
  // В ТП жёлтые: место в согласии, объём, скорость, число, две строки состава и звание — 7 мест.
  assert.ok(yellowMarks(open) >= 7, `жёлтых мест в ТП: ${yellowMarks(open)}`);
  const participant = await buildTpPdf("participant", DATA);
  const blanks = ((await pdfText(participant)).match(/\[заполните\]/g) ?? []).length;
  assert.ok(blanks > 0 && yellowMarks(participant) >= blanks, `пустые строки анкеты — жёлтые: ${blanks} строк, ${yellowMarks(participant)} жёлтых мест`);
  for (const part of ["tp", "participant", "declaration", "price"] as const) {
    assert.equal(yellowMarks(await buildTpPdf(part, FILLED)), 0, `${part}: подсветка там, где всё вписано`);
  }
});

test("техническое предложение в PDF не берёт реквизиты, даже если их передали; анкета и цена — берут", async () => {
  const tp = await pdfText(await buildTpPdf("tp", { ...DATA, profile: null }));
  for (const value of identityValues(PROFILE)) assert.ok(!tp.includes(value), `в ТП попало «${value}»`);
  assert.doesNotMatch(tp, /Участник закупки\s+_+/);

  const participant = await pdfText(await buildTpPdf("participant", DATA));
  for (const value of [PROFILE.fullName, PROFILE.inn, PROFILE.kpp, PROFILE.ogrn, PROFILE.account, "Иванова А. П.", "Петров П. П."]) {
    assert.ok(participant.replace(/\s+/g, " ").includes(value), `в анкете нет «${value}»`);
  }
  const price = (await pdfText(await buildTpPdf("price", DATA))).replace(/\s+/g, " ");
  assert.match(price, /685 000,00 руб\. \(Шестьсот восемьдесят пять тысяч рублей 00 копеек\), НДС не облагается в связи с применением УСН\./);
});

const post = (handler: typeof pdf, body: unknown) =>
  handler(new Request("http://localhost/api/tp/pdf", { method: "POST", body: JSON.stringify(body) }));

test("сервер: api/tp/pdf отдаёт PDF с русским именем; реквизиты в ТП не попадают; пустой черновик — 400", async () => {
  const request = { part: "tp", subject: DATA.subject, items: DATA.items, profile: PROFILE };
  const res = await post(pdf, request);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  const disposition = res.headers.get("content-disposition") ?? "";
  assert.match(disposition, /filename="proposal\.pdf"/);
  assert.ok(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]).endsWith("Техническое предложение.pdf"), disposition);
  const text = await pdfText(Buffer.from(await res.arrayBuffer()));
  for (const value of identityValues(PROFILE)) assert.ok(!text.includes(value), `в ТП попало «${value}»`);

  const anketa = await post(pdf, { ...request, part: "participant" });
  assert.match(await pdfText(Buffer.from(await anketa.arrayBuffer())), new RegExp(PROFILE.inn));

  // Готовый документ собирается только для анкеты, декларации и цены, как и в Word.
  const doc = { title: "Техническое предложение", basis: "", blocks: [{ type: "paragraph", text: `ИНН ${PROFILE.inn}`, rows: [] }] };
  assert.equal((await post(pdf, { part: "tp", doc, profile: PROFILE })).status, 400);
  assert.equal((await post(pdf, { part: "price", doc: { title: 1 } })).status, 400);
  assert.match(await (await post(pdf, { items: "пункт" })).text(), /В черновике нет пунктов/);
});

test("архив: по умолчанию файлы Word, с format «pdf» — PDF; имена по порядку, формат один на весь архив", async () => {
  const files = [{ part: "tp", subject: DATA.subject, items: DATA.items }, { part: "price", subject: DATA.subject, items: DATA.items, form: DATA.form, price: 685000, profile: PROFILE }];
  const names = async (body: object) => {
    const res = await zip(new Request("http://localhost/api/tp/zip", { method: "POST", body: JSON.stringify(body) }));
    assert.equal(res.status, 200, await res.clone().text());
    const archive = await JSZip.loadAsync(await res.arrayBuffer());
    return { names: Object.keys(archive.files), archive };
  };
  assert.deepEqual((await names({ name: "Заявка", files })).names, ["1. Техническое предложение.docx", "2. Предложение о цене договора.docx"]);

  const { names: pdfNames, archive } = await names({ name: "Заявка", files, format: "pdf" });
  assert.deepEqual(pdfNames, ["1. Техническое предложение.pdf", "2. Предложение о цене договора.pdf"]);
  const inside = Buffer.from(await archive.file(pdfNames[1])!.async("uint8array"));
  assert.equal(inside.subarray(0, 5).toString(), "%PDF-");
  assert.match((await pdfText(inside)).replace(/\s+/g, " "), /685 000,00 руб\./);

  // Неизвестный формат — Word, а не отказ: так старые запросы продолжают работать.
  assert.deepEqual((await names({ files, format: "rtf" })).names, ["1. Техническое предложение.docx", "2. Предложение о цене договора.docx"]);
});
