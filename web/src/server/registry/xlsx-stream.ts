import "server-only";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import JSZip from "jszip";
import type { Cell, RawRow } from "@/lib/registry-format";
import { RegistryError } from "@/lib/registry-types";

// Потоковое чтение листа XLSX. Выгрузка реестра — сотни тысяч строк и сотни мегабайт XML: целиком в память лист не читается,
// строки отдаются по одной. Своё чтение, а не exceljs, потому что выгрузка ГИСП не пишет адреса ячеек (`r="B7"`) —
// ячейка без адреса стоит сразу за предыдущей, а exceljs на таких файлах падает.
//
// Защита: размер файла и распакованных данных ограничен (архив-«бомба»), макросы и встроенные объекты отвергаются,
// всё содержимое ячеек — данные, формулы не вычисляются.

export type XlsxLimits = {
  maxFileBytes: number;
  maxEntries: number;
  maxSheetBytes: number;
  maxSharedStringBytes: number;
  maxElementChars: number;
};

export const DEFAULT_LIMITS: XlsxLimits = {
  maxFileBytes: 200 * 1024 * 1024,
  maxEntries: 200,
  maxSheetBytes: 2 * 1024 * 1024 * 1024,
  maxSharedStringBytes: 600 * 1024 * 1024,
  maxElementChars: 2 * 1024 * 1024,
};

const DANGEROUS = /vbaProject|\.bin$|\.exe$|\.dll$|\.js$|\.vbs$|\.bat$|\.cmd$|embeddings\/|activeX\//i;

export type OpenedXlsx = {
  sha256: string;
  size: number;
  sheetName: string;
  rows: AsyncGenerator<RawRow>;
  /** Размер листа из самого файла; известен после того, как чтение началось. */
  declaredRows: () => number | null;
};

const ENTITY = /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (_, dec, hex, name) => {
    if (name) return NAMED[name];
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

/** Блоки `<tag ...>...</tag>` и `<tag .../>` из растущего текста: отдаёт целые блоки, остаток возвращает. */
function takeBlocks(buffer: string, tag: string, onBlock: (block: string) => void, maxChars: number): string {
  const open = `<${tag}`;
  let pos = 0;
  for (;;) {
    const start = buffer.indexOf(open, pos);
    if (start === -1) return buffer.slice(Math.max(pos, buffer.length - open.length));
    if (start + open.length >= buffer.length) return buffer.slice(start);
    const next = buffer.charCodeAt(start + open.length);
    // `<row` — не `<rowBreaks`: после имени тега должен идти пробел, `>` или `/`.
    if (!(next === 32 || next === 62 || next === 47 || next === 10 || next === 13 || next === 9)) {
      pos = start + open.length;
      continue;
    }
    const tagEnd = buffer.indexOf(">", start);
    if (tagEnd === -1) return buffer.slice(start);
    if (buffer.charCodeAt(tagEnd - 1) === 47) {
      onBlock(buffer.slice(start, tagEnd + 1));
      pos = tagEnd + 1;
      continue;
    }
    const close = buffer.indexOf(`</${tag}>`, tagEnd);
    if (close === -1) {
      if (buffer.length - start > maxChars) throw new RegistryError("invalid_file", `Элемент <${tag}> слишком большой: файл не похож на выгрузку.`);
      return buffer.slice(start);
    }
    const end = close + tag.length + 3;
    onBlock(buffer.slice(start, end));
    pos = end;
  }
}

type OldStream = NodeJS.ReadableStream & { destroy?: () => void };

/** Поток jszip (старый образец Node) → порции по требованию: следующая читается, только когда обработана предыдущая. */
async function* chunksOf(stream: OldStream): AsyncGenerator<Uint8Array> {
  const queue: Uint8Array[] = [];
  let ended = false;
  let failure: unknown = null;
  let notify: (() => void) | null = null;
  const wake = () => {
    const fn = notify;
    notify = null;
    fn?.();
  };
  stream.on("data", (chunk: Uint8Array) => {
    queue.push(chunk);
    stream.pause();
    wake();
  });
  stream.on("end", () => {
    ended = true;
    wake();
  });
  stream.on("error", (error: unknown) => {
    failure = error;
    wake();
  });
  try {
    for (;;) {
      if (queue.length) {
        yield queue.shift()!;
        continue;
      }
      if (failure) throw failure;
      if (ended) return;
      const waiting = new Promise<void>((resolve) => (notify = resolve));
      stream.resume();
      await waiting;
    }
  } finally {
    stream.destroy?.();
  }
}

async function* textChunks(source: AsyncIterable<Uint8Array | string>, limit: number, what: string): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8");
  let bytes = 0;
  for await (const chunk of source) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    bytes += buf.length;
    if (bytes > limit) throw new RegistryError("too_large", `${what}: распакованных данных больше ${Math.round(limit / 1048576)} МБ — файл отклонён.`);
    const text = decoder.write(buf);
    if (text) yield text;
  }
  const rest = decoder.end();
  if (rest) yield rest;
}

const stringOfSi = (block: string): string => {
  // Фонетические подсказки <rPh> в текст не входят.
  const clean = block.replace(/<rPh[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const match of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += match[1];
  return decodeXml(out);
};

const columnIndex = (ref: string): number => {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
};

/** Одна строка листа → ячейки по порядку колонок. Ячейка без адреса стоит сразу за предыдущей. */
export function parseSheetRow(block: string, shared: string[], previousRow: number): RawRow | null {
  const head = /^<row\b([^>]*?)\/?>/.exec(block);
  if (!head) return null;
  const rowRef = /\br="(\d+)"/.exec(head[1]);
  const rowNumber = rowRef ? Number(rowRef[1]) : previousRow + 1;
  const cells: Cell[] = [];
  if (block.endsWith("/>") && !block.includes("</row>")) return { rowNumber, cells };
  let cursor = -1;
  for (const match of block.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = match[1];
    const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
    cursor = ref ? columnIndex(ref[1]) : cursor + 1;
    const type = /\bt="(\w+)"/.exec(attrs)?.[1];
    const body = match[2] ?? "";
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let value: Cell = null;
    if (type === "inlineStr") {
      value = stringOfSi(body);
    } else if (v !== undefined) {
      if (type === "s") value = shared[Number(v)] ?? null;
      else if (type === "b") value = v === "1";
      else if (type === "str" || type === "e") value = decodeXml(v);
      else if (type === "d") value = decodeXml(v);
      else {
        const n = Number(v);
        value = Number.isFinite(n) ? n : decodeXml(v);
      }
    }
    cells[cursor] = value;
  }
  return { rowNumber, cells };
}

function declaredRowsOf(head: string): number | null {
  const ref = /<dimension\s+ref="([^"]+)"/.exec(head)?.[1];
  const last = ref?.split(":").pop();
  const rows = last ? Number(/(\d+)$/.exec(last)?.[1]) : NaN;
  return Number.isFinite(rows) && rows > 0 ? rows : null;
}

/** Путь первого листа книги: через workbook.xml и его связи, а не по имени sheet1.xml. */
async function firstSheet(zip: JSZip): Promise<{ path: string; name: string }> {
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbook || !rels) throw new RegistryError("invalid_file", "В файле нет книги Excel (xl/workbook.xml): это не XLSX.");
  const sheet = /<sheet\b[^>]*>/.exec(workbook)?.[0];
  const relId = sheet && /\br:id="([^"]+)"/.exec(sheet)?.[1];
  const name = sheet ? decodeXml(/\bname="([^"]*)"/.exec(sheet)?.[1] ?? "") : "";
  if (!relId) throw new RegistryError("invalid_file", "В книге нет листов.");
  for (const rel of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (new RegExp(`\\bId="${relId}"`).test(rel[0])) {
      const target = /\bTarget="([^"]+)"/.exec(rel[0])?.[1];
      if (target) return { path: target.startsWith("/") ? target.slice(1) : `xl/${target}`, name };
    }
  }
  throw new RegistryError("invalid_file", "Не найден первый лист книги.");
}

export async function openXlsx(path: string, limits: Partial<XlsxLimits> = {}): Promise<OpenedXlsx> {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) throw new RegistryError("invalid_input", "Файл не найден.");
  if (info.size > lim.maxFileBytes) throw new RegistryError("too_large", `Файл больше ${Math.round(lim.maxFileBytes / 1048576)} МБ.`);
  const buffer = await readFile(path);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new RegistryError("invalid_file", "Файл повреждён или не является XLSX (не открывается как архив).");
  }
  const names = Object.keys(zip.files);
  if (names.length > lim.maxEntries) throw new RegistryError("invalid_file", "В файле слишком много вложений.");
  const bad = names.find((n) => DANGEROUS.test(n));
  if (bad) throw new RegistryError("invalid_file", `В файле есть недопустимое вложение «${bad}» (макросы и встроенные объекты не принимаются).`);
  if (!zip.file("[Content_Types].xml")) throw new RegistryError("invalid_file", "Файл не похож на XLSX: нет [Content_Types].xml.");

  const sheet = await firstSheet(zip);
  const sheetEntry = zip.file(sheet.path);
  if (!sheetEntry) throw new RegistryError("invalid_file", `Не найден лист «${sheet.name}».`);
  const sheetFile: JSZip.JSZipObject = sheetEntry;
  let declared: number | null = null;

  const rows = (async function* (): AsyncGenerator<RawRow> {
    try {
      yield* readRows();
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      throw new RegistryError("invalid_file", "Файл повреждён: не удалось распаковать данные листа.");
    }
  })();

  async function* readRows(): AsyncGenerator<RawRow> {
    // Общие строки: все сразу, они нужны до первой строки листа.
    const shared: string[] = [];
    const sstEntry = zip.file("xl/sharedStrings.xml");
    if (sstEntry) {
      let carry = "";
      for await (const text of textChunks(chunksOf(sstEntry.nodeStream("nodebuffer") as OldStream), lim.maxSharedStringBytes, "Общие строки")) {
        carry = takeBlocks(carry + text, "si", (block) => shared.push(stringOfSi(block)), lim.maxElementChars);
      }
    }
    let carry = "";
    let previousRow = 0;
    let first = true;
    for await (const text of textChunks(chunksOf(sheetFile.nodeStream("nodebuffer") as OldStream), lim.maxSheetBytes, "Лист")) {
      if (first) {
        declared = declaredRowsOf(text.slice(0, 4096));
        first = false;
      }
      const ready: RawRow[] = [];
      carry = takeBlocks(
        carry + text,
        "row",
        (block) => {
          const row = parseSheetRow(block, shared, previousRow);
          if (row) {
            previousRow = row.rowNumber;
            ready.push(row);
          }
        },
        lim.maxElementChars,
      );
      for (const row of ready) yield row;
    }
  }

  return { sha256, size: info.size, sheetName: sheet.name, rows, declaredRows: () => declared };
}
