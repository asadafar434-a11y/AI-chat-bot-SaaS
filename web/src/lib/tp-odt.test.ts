// Файлы ODT заявки: тот же текст, что в Word и PDF, жёлтые места остаются жёлтыми, ТП — без реквизитов участника — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import JSZip from "jszip";
import mammoth from "mammoth";
import { POST as odt } from "../app/api/tp/odt/route.ts";
import { POST as zip } from "../app/api/tp/zip/route.ts";
import { identityValues } from "./profile.ts";
import { modelOfPartDoc, modelOfTp, type Block, type Table } from "./tp-doc-model.ts";
import { buildPartDocx, buildTpDocx } from "./tp-docx.ts";
import { DATA, DOC, FILLED, PARTS, PROFILE } from "./tp-fixtures.ts";
import { buildPartOdt, buildTpOdt, renderOdt } from "./tp-odt.ts";

const MIME = "application/vnd.oasis.opendocument.text";
const XML_FILES = ["META-INF/manifest.xml", "content.xml", "styles.xml", "meta.xml"];

const xml = (buffer: Buffer, name: string) => strFromU8(unzipSync(buffer)[name]);

// Минимальная проверка XML: теги закрыты в нужном порядке, атрибуты в кавычках, «&» только как сущность, управляющих знаков
// нет, у каждого префикса объявлено пространство имён. Программы для ODT строгие: ошибка здесь — файл не откроется.
function assertWellFormed(source: string, name: string) {
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(source), `${name}: управляющие знаки`);
  const body = source.replace(/^<\?xml[^>]*\?>\s*/, "");
  const declared = new Set([...body.matchAll(/xmlns:([\w-]+)=/g)].map((m) => m[1]));
  const notEntity = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
  const stack: string[] = [];
  for (const part of body.split(/(<[^>]*>)/)) {
    if (!part) continue;
    if (!part.startsWith("<")) {
      assert.ok(!notEntity.test(part), `${name}: «&» в тексте не сущность: ${part.slice(0, 60)}`);
      continue;
    }
    const tag = /^<(\/)?([A-Za-z][\w.-]*(?::[\w.-]+)?)((?:\s+[\w.-]+(?::[\w.-]+)?="[^"<]*")*)\s*(\/)?>$/.exec(part);
    assert.ok(tag, `${name}: плохой тег ${part.slice(0, 80)}`);
    const [, closing, tagName, attributes = "", selfClosing] = tag;
    assert.ok(!notEntity.test(attributes), `${name}: «&» в атрибуте не сущность`);
    const used = [...tagName.matchAll(/^([\w.-]+):/g), ...attributes.matchAll(/\s([\w.-]+):[\w.-]+=/g)].map((m) => m[1]);
    for (const prefix of used) assert.ok(prefix === "xmlns" || declared.has(prefix), `${name}: не объявлен префикс «${prefix}»`);
    if (closing) assert.equal(stack.pop(), tagName, `${name}: закрыт не тот тег ${tagName}`);
    else if (!selfClosing) stack.push(tagName);
  }
  assert.deepEqual(stack, [], `${name}: не закрыты теги`);
}

const unescape = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// Текст документа так, как его видит человек: теги пробелов и переносов — пробелами, абзацы — строками.
function odtText(buffer: Buffer): string {
  return unescape(
    xml(buffer, "content.xml")
      .replace(/<text:(?:line-break|tab)\/>/g, " ")
      .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_, n) => " ".repeat(Number(n ?? 1)))
      .replace(/<\/text:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
  );
}

const docxText = async (buffer: Buffer) => (await mammoth.extractRawText({ buffer })).value;

// Слова документа без учёта переносов строк и порядка ячеек: по ним видно, что в двух форматах одно и то же.
const words = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).sort();

const tablesOf = (blocks: Block[]) => blocks.filter((b): b is Table => b.type === "table");
const paragraphsOf = (blocks: Block[]) => blocks.flatMap((b) => (b.type === "p" ? [b] : b.rows.flatMap((r) => r.cells.flatMap((c) => c.paras))));
const highlighted = (blocks: Block[]) => paragraphsOf(blocks).flatMap((p) => p.runs).filter((r) => r.highlight).length;

// Сколько кусков текста в файле подсвечено жёлтым: стили с жёлтым фоном и места, где они применены.
function yellowSpans(content: string): number {
  const styles = [...content.matchAll(/<style:style style:name="(T\d+)" style:family="text"><style:text-properties[^>]*fo:background-color="#ffff00"/g)].map((m) => m[1]);
  if (!styles.length) return 0;
  return (content.match(new RegExp(`<text:span text:style-name="(?:${styles.join("|")})">`, "g")) ?? []).length;
}

test("ODT: архив устроен по стандарту — mimetype первым и без сжатия, манифест перечисляет все файлы", () => {
  const buffer = buildTpOdt("tp", DATA);
  assert.equal(buffer.readUInt32LE(0), 0x04034b50, "файл начинается не с архива");
  assert.equal(buffer.readUInt16LE(8), 0, "mimetype сжат");
  assert.equal(buffer.readUInt16LE(28), 0, "у mimetype есть дополнительное поле");
  assert.equal(buffer.subarray(30, 38).toString(), "mimetype");
  assert.equal(buffer.subarray(38, 38 + MIME.length).toString(), MIME);

  assert.deepEqual(Object.keys(unzipSync(buffer)), ["mimetype", ...XML_FILES]);
  const manifest = xml(buffer, "META-INF/manifest.xml");
  assert.match(manifest, new RegExp(`manifest:full-path="/"[^>]*manifest:media-type="${MIME}"`));
  for (const name of ["content.xml", "styles.xml", "meta.xml"]) assert.match(manifest, new RegExp(`manifest:full-path="${name}"`));
  assert.match(xml(buffer, "meta.xml"), /<dc:title>Техническое предложение<\/dc:title>/);
});

test("ODT: XML всех файлов собран правильно — теги закрыты, «&» экранирован, префиксы объявлены", () => {
  const buffers = [...PARTS.map((part) => buildTpOdt(part, DATA)), ...PARTS.map((part) => buildTpOdt(part, FILLED)), buildPartOdt(DOC)];
  for (const buffer of buffers) for (const name of XML_FILES) assertWellFormed(xml(buffer, name), name);
});

test("слова в ODT и в Word совпадают по каждой части заявки — файлы разных форматов не расходятся", async () => {
  for (const variant of [DATA, { ...DATA, goods: [], cast: null, price: null, profile: null, subject: "" }]) {
    for (const part of PARTS) {
      const fromOdt = words(odtText(buildTpOdt(part, variant)));
      const fromDocx = words(await docxText(await buildTpDocx(part, variant)));
      assert.deepEqual(fromOdt, fromDocx, `${part}: текст в ODT и в Word разный`);
    }
  }
  // Готовый документ, который написал ИИ: заголовок, абзацы, строки и таблица.
  assert.deepEqual(words(odtText(buildPartOdt(DOC))), words(await docxText(await buildPartDocx(DOC))));
});

test("жёлтые места «[…]» остаются жёлтыми и в ODT; когда всё вписано — подсветки нет", () => {
  for (const part of PARTS) {
    const expected = highlighted(modelOfTp(part, DATA).blocks);
    assert.equal(yellowSpans(xml(buildTpOdt(part, DATA), "content.xml")), expected, `${part}: жёлтых мест не столько, сколько в описании документа`);
  }
  // В ТП жёлтые: место в согласии, объём, скорость, число, две строки состава и звание — 7 мест.
  assert.ok(yellowSpans(xml(buildTpOdt("tp", DATA), "content.xml")) >= 7);
  assert.equal(yellowSpans(xml(buildPartOdt(DOC), "content.xml")), highlighted(modelOfPartDoc(DOC).blocks));
  for (const part of ["tp", "participant", "declaration", "price"] as const) {
    assert.equal(yellowSpans(xml(buildTpOdt(part, FILLED), "content.xml")), 0, `${part}: подсветка там, где всё вписано`);
  }
});

test("таблицы в ODT: столько же таблиц, строк и ячеек, заголовок повторяется, столбцы занимают всю ширину текста", () => {
  for (const part of PARTS) {
    const tables = tablesOf(modelOfTp(part, DATA).blocks);
    const content = xml(buildTpOdt(part, DATA), "content.xml");
    assert.equal((content.match(/<table:table /g) ?? []).length, tables.length, `${part}: таблиц`);
    assert.equal((content.match(/<table:table-row>/g) ?? []).length, tables.reduce((n, t) => n + t.rows.length, 0), `${part}: строк`);
    assert.equal((content.match(/<table:table-cell /g) ?? []).length, tables.reduce((n, t) => n + t.rows.length * t.rows[0].cells.length, 0), `${part}: ячеек`);
    assert.equal((content.match(/<table:table-header-rows>/g) ?? []).length, tables.filter((t) => t.rows[0]?.header).length, `${part}: повтор заголовка`);
    tables.forEach((table, index) => {
      const pattern = new RegExp(`style:name="Table${index + 1}\\.[A-Z]+" style:family="table-column"><style:table-column-properties style:column-width="([\\d.]+)cm"`, "g");
      const widths = [...content.matchAll(pattern)].map((m) => Number(m[1]));
      assert.equal(widths.length, table.rows[0].cells.length, `${part}: столбцов в таблице ${index + 1}`);
      assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 16.5) < 0.01, `${part}: ширины ${widths.join(" + ")} не дают 16,5 см`);
    });
  }
});

test("техническое предложение в ODT не берёт реквизиты, даже если их передали; анкета и цена — берут", () => {
  const tp = odtText(buildTpOdt("tp", { ...DATA, profile: null }));
  for (const value of identityValues(PROFILE)) assert.ok(!tp.includes(value), `в ТП попало «${value}»`);
  assert.doesNotMatch(tp, /Участник закупки\s+_+/);

  const participant = odtText(buildTpOdt("participant", DATA)).replace(/\s+/g, " ");
  for (const value of [PROFILE.fullName, PROFILE.inn, PROFILE.kpp, PROFILE.ogrn, PROFILE.account, "Иванова А. П.", "Петров П. П."]) {
    assert.ok(participant.includes(value), `в анкете нет «${value}»`);
  }
  const price = odtText(buildTpOdt("price", DATA)).replace(/\s+/g, " ");
  assert.match(price, /685 000,00 руб\. \(Шестьсот восемьдесят пять тысяч рублей 00 копеек\), НДС не облагается в связи с применением УСН\./);
});

test("ODT: пробелы, табуляция, перенос строки и спецзнаки доходят до файла и не ломают его", () => {
  const text = "  ведущий   пробел\tтаб\nстрока & <тег> \"кавычки\" \u0001\u0008 мусор 😀 конец ";
  const buffer = renderOdt({
    title: 'Название & "проверка" <1>',
    blocks: [
      { type: "p", runs: [{ text }, { text: " жирный", bold: true }] },
      { type: "table", rows: [{ cells: [{ width: 100, paras: [{ type: "p", runs: [{ text: "ячейка\tс табуляцией" }] }] }] }] },
    ],
  });
  for (const name of XML_FILES) assertWellFormed(xml(buffer, name), name);
  const content = xml(buffer, "content.xml");
  assert.ok(
    content.includes('<text:s text:c="2"/>ведущий<text:s text:c="3"/>пробел<text:tab/>таб<text:line-break/>строка &amp; &lt;тег&gt; &quot;кавычки&quot;<text:s text:c="2"/>мусор 😀 конец<text:s/>'),
    content.slice(content.indexOf("<office:text>"), content.indexOf("<office:text>") + 400)
  );
  assert.ok(content.includes('<text:span text:style-name="T1"><text:s/>жирный</text:span>'), "пробел в начале куска пропал");
  assert.ok(content.includes("ячейка<text:tab/>с табуляцией"));
  assert.ok(!/[\u0001\u0008]/.test(content), "мусорные знаки остались");
  assert.ok(xml(buffer, "meta.xml").includes("<dc:title>Название &amp; &quot;проверка&quot; &lt;1&gt;</dc:title>"));
});

const post = (handler: typeof odt, body: unknown) => handler(new Request("http://localhost/api/tp/odt", { method: "POST", body: JSON.stringify(body) }));

test("сервер: api/tp/odt отдаёт ODT с русским именем; реквизиты в ТП не попадают; пустой черновик — 400", async () => {
  const request = { part: "tp", subject: DATA.subject, items: DATA.items, profile: PROFILE };
  const res = await post(odt, request);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), MIME);
  const disposition = res.headers.get("content-disposition") ?? "";
  assert.match(disposition, /filename="proposal\.odt"/);
  assert.ok(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]).endsWith("Техническое предложение.odt"), disposition);
  const file = Buffer.from(await res.arrayBuffer());
  assert.equal(file.subarray(30, 38).toString(), "mimetype");
  for (const value of identityValues(PROFILE)) assert.ok(!odtText(file).includes(value), `в ТП попало «${value}»`);

  const anketa = await post(odt, { ...request, part: "participant" });
  assert.match(odtText(Buffer.from(await anketa.arrayBuffer())), new RegExp(PROFILE.inn));

  // Готовый документ собирается только для анкеты, декларации и цены, как и в Word.
  const doc = { title: "Техническое предложение", basis: "", blocks: [{ type: "paragraph", text: `ИНН ${PROFILE.inn}`, rows: [] }] };
  assert.equal((await post(odt, { part: "tp", doc, profile: PROFILE })).status, 400);
  assert.equal((await post(odt, { part: "price", doc: { title: 1 } })).status, 400);
  assert.match(await (await post(odt, { items: "пункт" })).text(), /В черновике нет пунктов/);
});

test("архив: с format «odt» — файлы ODT, имена по порядку, формат один на весь архив", async () => {
  const files = [{ part: "tp", subject: DATA.subject, items: DATA.items }, { part: "price", subject: DATA.subject, items: DATA.items, form: DATA.form, price: 685000, profile: PROFILE }];
  const res = await zip(new Request("http://localhost/api/tp/zip", { method: "POST", body: JSON.stringify({ name: "Заявка", files, format: "odt" }) }));
  assert.equal(res.status, 200, await res.clone().text());
  const archive = await JSZip.loadAsync(await res.arrayBuffer());
  const names = Object.keys(archive.files);
  assert.deepEqual(names, ["1. Техническое предложение.odt", "2. Предложение о цене договора.odt"]);
  const inside = Buffer.from(await archive.file(names[1])!.async("uint8array"));
  assert.equal(inside.subarray(30, 38).toString(), "mimetype");
  assert.match(odtText(inside).replace(/\s+/g, " "), /685 000,00 руб\./);
});
