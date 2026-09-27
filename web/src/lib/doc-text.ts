// Текст из старых файлов Word без сторонних библиотек.
// .doc (Word 97–2003) — это контейнер из потоков (формат MS-CFB). Текст лежит в потоке WordDocument
// кусками, а где какой кусок и в какой кодировке, записано в таблице кусков в потоке 0Table или 1Table.
// Часть «.doc» у заказчиков на деле — RTF: его разбираем отдельно.

export class DocTextError extends Error {}

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;

type Entry = { name: string; type: number; left: number; right: number; child: number; start: number; size: number };

export const isOle = (buf: Buffer) => buf.subarray(0, 8).equals(OLE_SIGNATURE);

// Потоки верхнего уровня контейнера по именам. Вложенные объекты (например, вставленная таблица Excel)
// лежат глубже и сюда не попадают — иначе их поток WordDocument мог бы подменить основной.
function readContainer(buf: Buffer): Map<string, Buffer> {
  const sectorSize = 1 << buf.readUInt16LE(0x1e);
  const miniSize = 1 << buf.readUInt16LE(0x20);
  const fatCount = buf.readUInt32LE(0x2c);
  const firstDir = buf.readUInt32LE(0x30);
  const miniCutoff = buf.readUInt32LE(0x38);
  const firstMiniFat = buf.readUInt32LE(0x3c);
  const miniFatCount = buf.readUInt32LE(0x40);
  const offset = (sector: number) => (sector + 1) * sectorSize;

  // Где лежат сектора таблицы размещения: первые 109 — в заголовке, остальные — цепочкой секторов.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) fatSectors.push(buf.readUInt32LE(0x4c + i * 4));
  const perDifat = sectorSize / 4 - 1;
  for (let s = buf.readUInt32LE(0x44), n = 0; s !== END_OF_CHAIN && s !== FREE && fatSectors.length < fatCount; n++) {
    if (n > fatCount || offset(s) + sectorSize > buf.length) throw new DocTextError("повреждённый файл");
    for (let i = 0; i < perDifat && fatSectors.length < fatCount; i++) fatSectors.push(buf.readUInt32LE(offset(s) + i * 4));
    s = buf.readUInt32LE(offset(s) + perDifat * 4);
  }

  const fat: number[] = [];
  for (const s of fatSectors) {
    if (offset(s) + sectorSize > buf.length) throw new DocTextError("повреждённый файл");
    for (let i = 0; i < sectorSize / 4; i++) fat.push(buf.readUInt32LE(offset(s) + i * 4));
  }

  const chain = (start: number, table: number[]) => {
    const sectors: number[] = [];
    for (let s = start; s !== END_OF_CHAIN && s !== FREE; s = table[s]) {
      if (s >= table.length || sectors.length > table.length) throw new DocTextError("повреждённый файл");
      sectors.push(s);
    }
    return sectors;
  };
  const read = (start: number, size?: number) => {
    const data = Buffer.concat(chain(start, fat).map((s) => buf.subarray(offset(s), offset(s) + sectorSize)));
    return size === undefined ? data : data.subarray(0, size);
  };

  const dir = read(firstDir);
  const entries: Entry[] = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const nameLength = Math.min(64, dir.readUInt16LE(at + 0x40));
    entries.push({
      name: dir.toString("utf16le", at, at + Math.max(0, nameLength - 2)),
      type: dir[at + 0x42],
      left: dir.readUInt32LE(at + 0x44),
      right: dir.readUInt32LE(at + 0x48),
      child: dir.readUInt32LE(at + 0x4c),
      start: dir.readUInt32LE(at + 0x74),
      size: dir.readUInt32LE(at + 0x78),
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw new DocTextError("повреждённый файл");

  // Маленькие потоки хранятся внутри «мини-потока» корня со своей таблицей размещения.
  const miniStream = read(root.start, root.size);
  const miniFatData = miniFatCount ? read(firstMiniFat) : Buffer.alloc(0);
  const miniFat: number[] = [];
  for (let i = 0; i + 4 <= miniFatData.length; i += 4) miniFat.push(miniFatData.readUInt32LE(i));

  const streams = new Map<string, Buffer>();
  const stack = [root.child];
  const seen = new Set<number>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id >= entries.length || seen.has(id)) continue;
    seen.add(id);
    const entry = entries[id];
    stack.push(entry.left, entry.right);
    if (entry.type !== 2) continue;
    streams.set(
      entry.name,
      entry.size < miniCutoff
        ? Buffer.concat(chain(entry.start, miniFat).map((s) => miniStream.subarray(s * miniSize, (s + 1) * miniSize))).subarray(0, entry.size)
        : read(entry.start, entry.size)
    );
  }
  return streams;
}

// Однобайтовый текст в .doc — это Windows-1252; кириллица всегда хранится двухбайтовой.
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const decode8 = (bytes: Buffer) => bytes.toString("latin1").replace(/[\x80-\x9f]/g, (c) => CP1252_HIGH[c.charCodeAt(0) - 0x80]);

// Служебные символы Word — в обычный текст: абзацы и разрывы — переводы строк, ячейки таблиц — табуляции,
// от полей (оглавление, ссылки, номера страниц) остаётся только то, что видно на странице.
function plain(raw: string): string {
  let text = raw;
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(/\x13[^\x13\x14\x15]*\x14([^\x13\x14\x15]*)\x15/g, "$1").replace(/\x13[^\x13\x14\x15]*\x15/g, "");
  }
  return text
    .replace(/[\x13\x14\x15]/g, "")
    .replace(/\x07\x07(?!\x07)/g, "\n")
    .replace(/\x07/g, "\t")
    .replace(/[\r\x0b\x0c]/g, "\n")
    .replace(/\x1e/g, "-")
    .replace(/[\x00-\x08\x0e-\x1f]/g, "")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function docText(buf: Buffer): string {
  const streams = readContainer(buf);
  const word = streams.get("WordDocument");
  if (!word || word.length < 0x200) throw new DocTextError("в файле нет документа Word");
  if (word.readUInt16LE(0) !== 0xa5ec) throw new DocTextError("очень старый формат Word (6.0/95)");
  const flags = word.readUInt16LE(0x0a);
  if (flags & 0x0100) throw new DocTextError("файл защищён паролем");
  const table = streams.get(flags & 0x0200 ? "1Table" : "0Table");
  if (!table) throw new DocTextError("повреждённый файл");

  // Заголовок документа (FIB): после постоянной части идут массивы переменной длины — считаем смещения по ним.
  const csw = word.readUInt16LE(0x20);
  const lwStart = 0x22 + csw * 2 + 2;
  const cslw = word.readUInt16LE(0x22 + csw * 2);
  const ccpText = word.readInt32LE(lwStart + 3 * 4);
  const fcLcb = lwStart + cslw * 4 + 2;
  const fcClx = word.readUInt32LE(fcLcb + 33 * 8);
  const lcbClx = word.readUInt32LE(fcLcb + 33 * 8 + 4);
  if (!lcbClx || fcClx + lcbClx > table.length) throw new DocTextError("повреждённый файл");

  // В начале Clx могут быть блоки форматирования (0x01) — пропускаем их до таблицы кусков (0x02).
  const clx = table.subarray(fcClx, fcClx + lcbClx);
  let at = 0;
  while (at < clx.length && clx[at] === 0x01) at += 3 + clx.readUInt16LE(at + 1);
  if (clx[at] !== 0x02) throw new DocTextError("повреждённый файл");
  const plc = clx.subarray(at + 5, at + 5 + clx.readUInt32LE(at + 1));
  const pieces = Math.floor((plc.length - 4) / 12);

  let text = "";
  for (let i = 0; i < pieces; i++) {
    const count = plc.readUInt32LE((i + 1) * 4) - plc.readUInt32LE(i * 4);
    const fc = plc.readUInt32LE((pieces + 1) * 4 + i * 8 + 2);
    const compressed = (fc & 0x40000000) !== 0;
    const start = compressed ? (fc & 0x3fffffff) / 2 : fc & 0x3fffffff;
    const bytes = word.subarray(start, start + (compressed ? count : count * 2));
    text += compressed ? decode8(bytes) : bytes.toString("utf16le");
  }
  // Сначала идёт основной текст, за ним — сноски, колонтитулы и надписи. Берём основной.
  return plain(ccpText > 0 && ccpText <= text.length ? text.slice(0, ccpText) : text);
}

// RTF: текст идёт вперемешку с командами форматирования, кириллица — кодами \'e0 в кодировке документа
// или номером буквы в Юникоде: \u1072? — «а». Служебные группы (шрифты, стили, картинки, коды полей) пропускаем целиком.
const SKIP_GROUPS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "listtable", "listoverridetable", "rsidtbl",
  "generator", "themedata", "colorschememapping", "latentstyles", "datastore", "xmlnstbl", "fldinst", "header",
  "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "pgdsctbl", "revtbl", "filetbl",
]);
const WORD_TEXT: Record<string, string> = {
  par: "\n", line: "\n", row: "\n", page: "\n", sect: "\n", tab: "\t", cell: "\t",
  emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "«", rdblquote: "»",
};

// Кодировка байтов \'e0 зависит от шрифта: Word пишет кириллицу шрифтом «Times New Roman Cyr» (\fcharset204),
// а знаки вроде «×» — обычным (\fcharset0), и у документа в целом может стоять хоть «\ansicpg1254».
const CHARSET_CODEPAGE: Record<string, string> = {
  "0": "1252", "204": "1251", "238": "1250", "161": "1253", "162": "1254", "177": "1255", "178": "1256", "186": "1257", "163": "1258", "222": "874",
};

export function rtfText(buf: Buffer): string {
  const src = buf.toString("latin1");
  const fontPages = new Map<string, string>();
  for (const m of src.matchAll(/\{\\f(\d+)[^{};]*?\\fcharset(\d+)/g)) {
    if (CHARSET_CODEPAGE[m[2]]) fontPages.set(m[1], CHARSET_CODEPAGE[m[2]]);
  }
  const docPage = /\\ansicpg(\d+)/.exec(src)?.[1] ?? "1252";
  const defaultFont = /\\deff(\d+)/.exec(src)?.[1] ?? "0";
  const decoders = new Map<string, TextDecoder>();
  const decoderFor = (page: string) => {
    if (!decoders.has(page)) {
      let decoder: TextDecoder;
      try {
        decoder = new TextDecoder(`windows-${page}`);
      } catch {
        decoder = new TextDecoder("windows-1251");
      }
      decoders.set(page, decoder);
    }
    return decoders.get(page)!;
  };

  let out = "";
  let bytes: number[] = [];
  type State = { skip: boolean; uc: number; font: string };
  const stack: State[] = [];
  let state: State = { skip: false, uc: 1, font: defaultFont };
  const flush = () => {
    if (bytes.length) out += decoderFor(fontPages.get(state.font) ?? docPage).decode(new Uint8Array(bytes));
    bytes = [];
  };
  let pendingSkip = 0; // символы-заменители после \uN, которые надо пропустить

  for (let i = 0; i < src.length; ) {
    const ch = src[i];
    if (ch === "{") {
      flush();
      stack.push(state);
      state = { ...state };
      pendingSkip = 0;
      i++;
    } else if (ch === "}") {
      flush();
      state = stack.pop() ?? { skip: false, uc: 1, font: defaultFont };
      pendingSkip = 0;
      i++;
    } else if (ch === "\\") {
      const next = src[i + 1] ?? "";
      if (next === "'") {
        const byte = parseInt(src.slice(i + 2, i + 4), 16);
        i += 4;
        if (pendingSkip > 0) pendingSkip--;
        else if (!state.skip && Number.isFinite(byte)) bytes.push(byte);
        continue;
      }
      flush();
      const word = /^[a-zA-Z]+/.exec(src.slice(i + 1, i + 40))?.[0];
      if (!word) {
        // Символ после обратной косой: \\ \{ \} — сами символы, \~ — неразрывный пробел, \* — служебная группа.
        if (next === "*") state.skip = true;
        else if (!state.skip && pendingSkip === 0) out += next === "~" ? " " : next === "_" ? "-" : "\\{}".includes(next) ? next : "";
        i += 2;
        continue;
      }
      i += 1 + word.length;
      const param = /^-?\d+/.exec(src.slice(i, i + 12))?.[0];
      if (param) i += param.length;
      if (src[i] === " ") i++;
      pendingSkip = 0;
      if (word === "bin" && param) i += Number(param); // двоичные данные картинки — в них могут быть любые байты
      else if (SKIP_GROUPS.has(word)) state.skip = true;
      else if (word === "f" && param) state.font = param;
      else if (word === "plain") state.font = defaultFont;
      else if (word === "uc" && param) state.uc = Number(param);
      else if (word === "u" && param) {
        if (!state.skip) out += String.fromCharCode((Number(param) + 65536) % 65536);
        pendingSkip = state.uc;
      } else if (!state.skip && WORD_TEXT[word]) out += WORD_TEXT[word];
    } else {
      if (ch !== "\r" && ch !== "\n") {
        if (pendingSkip > 0) pendingSkip--;
        // Некоторые программы пишут кириллицу в RTF не кодами, а прямо байтами.
        else if (!state.skip && ch.charCodeAt(0) >= 0x80) bytes.push(ch.charCodeAt(0));
        else if (!state.skip) {
          flush();
          out += ch;
        }
      }
      i++;
    }
  }
  flush();
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
