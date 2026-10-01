// Чтение загруженных файлов: текст, Word, RTF под видом .doc, PDF, фото — npm test.
// Запросов к ИИ тут нет: сканы проверяются только до того места, где их пришлось бы распознавать.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Document, Packer, Paragraph } from "docx";
import ExcelJS from "exceljs";
import { extractText } from "./extract-text.ts";
import { pdf } from "./pdf-fixtures.ts";

const OCR_OFF = /распознавание сканов выключено/;
const NO_KEY = /распознавать сканы приложение может, когда подключён ИИ/;

// Ключ ИИ — на время одного теста.
async function withKey<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
  const saved = process.env.ANTHROPIC_API_KEY;
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
}

// Buffer — в копию: тип File принимает только байты поверх обычного ArrayBuffer.
const file = (name: string, content: string | Uint8Array, type = "") =>
  new File([typeof content === "string" ? content : new Uint8Array(content)], name, { type });

const docx = (...lines: string[]) =>
  Packer.toBuffer(new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] }));

const TEXT_PAGE = "Technical specification: supply of office paper, 500 packs";

test("текстовый файл и .docx", async () => {
  assert.deepEqual(await extractText(file("заметка.txt", "Срок подачи — 10 октября")), { ok: true, text: "Срок подачи — 10 октября" });
  const word = await extractText(file("ТЗ.docx", await docx("Техническое задание", "Бумага офисная А4 — 500 пачек")));
  assert.equal(word.ok, true);
  assert.match(word.ok ? word.text : "", /Техническое задание\s+Бумага офисная А4 — 500 пачек/);
});

test(".doc бывает RTF или .docx с другим расширением — оба читаются; не Word — понятная причина", async () => {
  // Кириллица в RTF — байтами в кодировке шрифта (\'cf — «П» в windows-1251) или кодами \uN.
  const rtf = "{\\rtf1\\ansi\\ansicpg1251\\deff0{\\fonttbl{\\f0\\fcharset204 Times New Roman Cyr;}}" +
    "\\f0 \\'cf\\'f0\\'e8\\'eb\\'ee\\'e6\\'e5\\'ed\\'e8\\'e5 1\\par \\u1044?\\u1072? \\endash  \\'f1\\'f0\\'ee\\'ea 5 \\'e4\\'ed\\'e5\\'e9}";
  const fromRtf = await extractText(file("Приложение.doc", Buffer.from(rtf, "latin1")));
  assert.equal(fromRtf.ok, true);
  assert.equal(fromRtf.ok && fromRtf.text.trim(), "Приложение 1\nДа – срок 5 дней");

  const renamed = await extractText(file("Проект договора.doc", await docx("Проект договора поставки")));
  assert.equal(renamed.ok && renamed.text.trim(), "Проект договора поставки");

  assert.deepEqual(await extractText(file("старый.doc", "это не документ Word")), {
    ok: false,
    reason: "не похоже на файл Word — пересохраните его в .docx",
  });
});

test("PDF с текстом читается без ИИ", async () => {
  const result = await withKey(undefined, () => extractText(file("Извещение.pdf", pdf([TEXT_PAGE, TEXT_PAGE]), "application/pdf")));
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.scan, undefined);
  assert.match(result.ok ? result.text : "", /Technical specification: supply of office paper, 500 packs/);
});

test("скан без текста: распознавание выключено или ИИ не подключён — объясняем, почему не прочитан", async () => {
  const scan = () => file("Скан ТЗ.pdf", pdf([null, null]));
  const off = await withKey("sk-test", () => extractText(scan(), { ocr: false }));
  assert.match(off.ok ? "" : off.reason, OCR_OFF);
  const noKey = await withKey(undefined, () => extractText(scan()));
  assert.match(noKey.ok ? "" : noKey.reason, NO_KEY);
});

test("PDF с вклеенной страницей-сканом без распознавания — текст остальных страниц всё равно читается", async () => {
  const result = await withKey(undefined, () => extractText(file("Анкета.pdf", pdf([TEXT_PAGE, null]))));
  assert.equal(result.ok, true);
  assert.match(result.ok ? result.text : "", /Technical specification/);
});

test("скан длиннее 60 страниц не отправляется в ИИ; число страниц — со склонением", async () => {
  for (const [pages, words] of [[61, "61 страницу"], [62, "62 страницы"], [65, "65 страниц"]] as const) {
    const result = await withKey("sk-test", () => extractText(file("Большой скан.pdf", pdf(Array(pages).fill(null)))));
    assert.equal(result.ok ? "" : result.reason, `скан на ${words} — распознаю не больше 60; разделите файл на части`);
  }
});

test("фото: выключено распознавание, нет ключа, больше 5 МБ — без запроса к ИИ", async () => {
  const photo = (size = 1000) => file("паспорт.jpg", new Uint8Array(size), "image/jpeg");
  const off = await withKey("sk-test", () => extractText(photo(), { ocr: false }));
  assert.match(off.ok ? "" : off.reason, OCR_OFF);
  const noKey = await withKey(undefined, () => extractText(photo()));
  assert.match(noKey.ok ? "" : noKey.reason, NO_KEY);
  const big = await withKey("sk-test", () => extractText(file("скан.png", new Uint8Array(5 * 1024 * 1024 + 1))));
  assert.match(big.ok ? "" : big.reason, /фото больше 5 МБ/);
});

test("неизвестный формат и повреждённый файл; имя файла в журнал не попадает", async (t) => {
  assert.deepEqual(await extractText(file("презентация.pptx", "PK")), { ok: false, reason: "формат пока не поддерживается" });
  assert.deepEqual(await extractText(file("смета.xlsx", "PK обрывок")), {
    ok: false,
    reason: "не удалось прочитать файл — возможно, он повреждён или защищён паролем",
  });

  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  const name = "Иванов Иван Иванович — анкета.docx";
  const broken = await extractText(file(name, "PK\u0003\u0004 обрывок архива"));
  assert.deepEqual(broken, { ok: false, reason: "не удалось прочитать файл — возможно, он повреждён или защищён паролем" });
  assert.ok(logged.length > 0);
  assert.doesNotMatch(logged.flat().map(String).join(" "), /Иванов/);
});

test(".xlsx читается по листам: формулы — значением, даты — по-русски, скрытые листы пропускаются, .xls — понятная причина", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Спецификация");
  sheet.addRow(["№", "Наименование", "Кол-во", "Цена", "Сумма"]);
  sheet.addRow([1, "Бумага А4,\nбелая", 100, 250.5, { formula: "C2*D2", result: 25050 }]);
  sheet.addRow([]);
  sheet.addRow(["", "Срок поставки", new Date(2026, 9, 20)]);
  book.addWorksheet("Скрытый").addRow(["секрет"]);
  book.getWorksheet("Скрытый")!.state = "hidden";
  const buffer = new Uint8Array(await book.xlsx.writeBuffer());

  const result = await extractText(file("спецификация.xlsx", buffer));
  assert.equal(result.ok, true);
  const text = result.ok ? result.text : "";
  assert.match(text, /## Лист «Спецификация»/);
  assert.match(text, /1 \| Бумага А4, белая \| 100 \| 250,5 \| 25050/);
  assert.match(text, /Срок поставки \| 20\.10\.2026/);
  assert.doesNotMatch(text, /секрет/);

  const old = await extractText(file("старый.xls", "x"));
  assert.deepEqual(old, { ok: false, reason: "старый формат .xls не читается — пересохраните файл как .xlsx" });
});
