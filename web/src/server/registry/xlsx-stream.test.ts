// Потоковое чтение XLSX: ячейки без адресов, общие и встроенные строки, большие листы, битые и опасные файлы — npm test.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import JSZip from "jszip";
import { FIXTURE_HEADER, PREFACE, fixtureRow } from "../../lib/registry-fixtures.ts";
import { importRegistry } from "../../lib/registry-import.ts";
import { createMemoryRegistryStore } from "../../lib/registry-store.ts";
import { RegistryError } from "../../lib/registry-types.ts";
import { decodeXml, openXlsx, parseSheetRow } from "./xlsx-stream.ts";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

async function build(sheetRows: string, sst: string[] = [], extra: Record<string, string> = {}, dimension = "A1:C3") {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("xl/workbook.xml", `<?xml version="1.0"?><workbook ${NS}><sheets><sheet name="Продукция" sheetId="1" r:id="rId2" /></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="styles.xml"/><Relationship Id="rId2" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file("xl/sharedStrings.xml", `<?xml version="1.0"?><sst ${NS} count="${sst.length}" uniqueCount="${sst.length}">${sst.join("")}</sst>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet ${NS}><dimension ref="${dimension}" /><sheetViews/><sheetData>${sheetRows}</sheetData></worksheet>`);
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  const dir = await mkdtemp(join(tmpdir(), "xlsx-test-"));
  const path = join(dir, "t.xlsx");
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const collect = async (path: string, limits = {}) => {
  const opened = await openXlsx(path, limits);
  const rows = [];
  for await (const row of opened.rows) rows.push(row);
  return { ...opened, collected: rows };
};

test("ячейки без адресов стоят за предыдущими; строки без адреса идут подряд; пустая строка остаётся пустой", async () => {
  const sst = ["<si><t>Заголовок</t></si>", "<si><t>А &amp; Б</t></si>", "<si><r><t>Част</t></r><r><t>и</t></r></si>"];
  const rows =
    '<row r="1" spans="1:1"><c r="A1" t="s"><v>0</v></c></row>' +
    '<row r="2" ht="15" />' +
    '<row r="3"><c r="A3" t="s"><v>1</v></c><c t="s"><v>2</v></c><c s="1"><v>46304</v></c><c t="b"><v>1</v></c></row>' +
    '<row><c r="B4" t="s"><v>0</v></c><c t="inlineStr"><is><t>встроенная</t></is></c></row>';
  const file = await build(rows, sst, {}, "A1:D4");
  try {
    const { collected, declaredRows, sheetName } = await collect(file.path);
    assert.equal(sheetName, "Продукция");
    assert.deepEqual(collected[0], { rowNumber: 1, cells: ["Заголовок"] });
    assert.deepEqual(collected[1], { rowNumber: 2, cells: [] });
    assert.deepEqual(collected[2].cells, ["А & Б", "Част" + "и", 46304, true], "общие строки, составной текст, число и логическое без адресов");
    assert.equal(collected[3].rowNumber, 4, "строка без адреса идёт за предыдущей");
    assert.equal(collected[3].cells[0], undefined, "колонка A пропущена");
    assert.equal(collected[3].cells[1], "Заголовок");
    assert.equal(collected[3].cells[2], "встроенная");
    assert.equal(declaredRows(), 4);
  } finally {
    await file.cleanup();
  }
});

test("большой лист читается целиком, строки не теряются на границах частей", async () => {
  const count = 30000;
  const sst = ['<si><t>Предприятие «Тестовое»</t></si>'];
  let rows = "";
  for (let i = 1; i <= count; i++) rows += `<row r="${i}"><c r="A${i}" t="s"><v>0</v></c><c><v>${i}</v></c><c t="b"><v>${i % 2}</v></c></row>`;
  const file = await build(rows, sst, {}, `A1:C${count}`);
  try {
    const { collected } = await collect(file.path);
    assert.equal(collected.length, count);
    assert.equal(collected[count - 1].cells[1], count);
    assert.ok(collected.every((r, i) => r.cells[1] === i + 1), "каждая строка на своём месте");
  } finally {
    await file.cleanup();
  }
});

test("файл не XLSX и повреждённый файл — понятная ошибка, а не падение", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xlsx-bad-"));
  try {
    const garbage = join(dir, "garbage.xlsx");
    await writeFile(garbage, Buffer.from("это совсем не архив".repeat(50)));
    await assert.rejects(openXlsx(garbage), (e: unknown) => e instanceof RegistryError && e.code === "invalid_file");

    const real = await build('<row r="1"><c r="A1"><v>1</v></c></row>');
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(real.path);
    const cut = join(dir, "cut.xlsx");
    await writeFile(cut, bytes.subarray(0, Math.floor(bytes.length / 2)));
    await assert.rejects(openXlsx(cut), (e: unknown) => e instanceof RegistryError && e.code === "invalid_file");
    await real.cleanup();

    const plainZip = new JSZip();
    plainZip.file("readme.txt", "привет");
    const notBook = join(dir, "notbook.xlsx");
    await writeFile(notBook, await plainZip.generateAsync({ type: "nodebuffer" }));
    await assert.rejects(openXlsx(notBook), (e: unknown) => e instanceof RegistryError && e.code === "invalid_file");

    await assert.rejects(openXlsx(join(dir, "нет-такого.xlsx")), (e: unknown) => e instanceof RegistryError && e.code === "invalid_input");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("макросы и встроенные объекты отвергаются", async () => {
  const file = await build('<row r="1"><c r="A1"><v>1</v></c></row>', [], { "xl/vbaProject.bin": "MZ-не-читаем" });
  try {
    await assert.rejects(openXlsx(file.path), (e: unknown) => e instanceof RegistryError && e.code === "invalid_file" && /vbaProject/.test(e.message));
  } finally {
    await file.cleanup();
  }
});

test("лимиты: большой файл и «бомба» с огромным распакованным листом не читаются", async () => {
  const bomb = await build(`<row r="1"><c r="A1" t="inlineStr"><is><t>${"A".repeat(2_000_000)}</t></is></c></row>`);
  try {
    await assert.rejects(openXlsx(bomb.path, { maxFileBytes: 10 }), (e: unknown) => e instanceof RegistryError && e.code === "too_large");
    await assert.rejects(collect(bomb.path, { maxSheetBytes: 100_000 }), (e: unknown) => e instanceof RegistryError && e.code === "too_large");
  } finally {
    await bomb.cleanup();
  }
});

test("сущности XML раскрываются, формулы остаются текстом", () => {
  assert.equal(decodeXml("&lt;a&gt; &amp; &quot;b&quot; &#1055;&#x41;"), '<a> & "b" ПA');
  const row = parseSheetRow('<row r="5"><c r="A5" t="str"><f>1+1</f><v>=1+1</v></c></row>', [], 4)!;
  assert.deepEqual(row.cells, ["=1+1"], "значение берётся как есть, формулы не вычисляются");
});

test("от файла до записей: настоящий XLSX → импорт в память", async () => {
  const strings = new Map<string, number>();
  const sst: string[] = [];
  const idx = (text: string) => {
    if (!strings.has(text)) {
      strings.set(text, sst.length);
      sst.push(`<si><t>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</t></si>`);
    }
    return strings.get(text)!;
  };
  const rowXml = (n: number, cells: (string | number | boolean | undefined)[]) =>
    `<row r="${n}">` +
    cells
      .map((v) => (v === undefined ? "<c/>" : typeof v === "string" ? `<c t="s"><v>${idx(v)}</v></c>` : typeof v === "boolean" ? `<c t="b"><v>${v ? 1 : 0}</v></c>` : `<c><v>${v}</v></c>`))
      .join("") +
    "</row>";
  const lines = [
    rowXml(1, ["Время выгрузки: 11.10.2026, 01:00:10"]),
    "<row r=\"2\"/>",
    rowXml(3, FIXTURE_HEADER),
    rowXml(4, fixtureRow({ number: "00000001" }) as never),
    rowXml(5, fixtureRow({ number: "00000002", name: "Тестовый стол & <шкаф>" }) as never),
  ].join("");
  void PREFACE;
  const file = await build(lines, sst, {}, "A1:AB5");
  try {
    const opened = await openXlsx(file.path);
    const store = createMemoryRegistryStore();
    const { report } = await importRegistry(store, { registryKind: "gisp_rpp_719", fileName: "t.xlsx", fileSha256: opened.sha256, rows: opened.rows, declaredRows: opened.declaredRows });
    assert.equal(report.recordsAdded, 2);
    assert.equal(store.records.get("gisp_rpp_719\n00000002")!.productName, "Тестовый стол & <шкаф>");
    assert.equal(store.datasets[0].fileSha256, opened.sha256);
    assert.equal(report.warnings["число_строк_не_совпало"], undefined);
  } finally {
    await file.cleanup();
  }
});
