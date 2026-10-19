// Старый Excel (.xls, Excel 97–2003, формат BIFF8) без сторонних библиотек. Файл — контейнер из потоков (MS-CFB, его читает doc-text.ts); поток «Workbook»
// состоит из записей «номер + длина + данные». Читаем то, что нужно для текста: листы и их видимость, строки и столбцы (скрытые), общие строки (SST, они
// бывают разорваны записями CONTINUE), числа (NUMBER, RK, MULRK), готовые значения формул, даты по формату ячейки. Дальше — общая часть с .xlsx (sheet-text.ts).
// Не читаются: Excel 5.0/95 (поток «Book»), файлы с паролем. Модуль без зависимостей от браузера и сервера.
import type { DocMap } from "@/lib/doc-source";
import { isOle, readContainer } from "@/lib/doc-text";
import { cleanText, numberText, sheetsText, type SheetCell, type SheetData } from "@/lib/sheet-text";

export class XlsError extends Error {}

const BOF = 0x0809;
const EOF = 0x000a;
const CONTINUE = 0x003c;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const XF = 0x00e0;
const FORMAT = 0x041e;
const DATE1904 = 0x0022;
const FILEPASS = 0x002f;
const ROW = 0x0208;
const COLINFO = 0x007d;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const FORMULA = 0x0006;
const STRING = 0x0207;
const BOOLERR = 0x0205;

type Rec = { id: number; data: Buffer; next: number };

function recordAt(book: Buffer, at: number): Rec | null {
  if (at + 4 > book.length) return null;
  const id = book.readUInt16LE(at);
  const size = book.readUInt16LE(at + 2);
  if (at + 4 + size > book.length) throw new XlsError("повреждённый файл");
  return { id, data: book.subarray(at + 4, at + 4 + size), next: at + 4 + size };
}

// Текст из байтов: сжатый («однобайтовый») — это Latin-1, остальное — UTF-16; кириллица всегда хранится двухбайтовой.
const chars = (buf: Buffer, at: number, count: number, high: boolean) => (high ? buf.toString("utf16le", at, at + 2 * count) : buf.toString("latin1", at, at + count));

// Строка в одной записи: длина (1 или 2 байта), флаги, символы. Для листов и форматов; пояснения к значениям (формат, расширение) пропускаем.
function shortString(buf: Buffer, at: number): string {
  const count = buf[at];
  return chars(buf, at + 2, count, (buf[at + 1] & 1) !== 0);
}
function longString(buf: Buffer, at: number): string {
  const count = buf.readUInt16LE(at);
  return chars(buf, at + 3, count, (buf[at + 2] & 1) !== 0);
}

// Общие строки (SST): записи SST и идущие за ней CONTINUE — одна лента. Строка может оборваться посреди символов: тогда следующая запись
// начинается байтом флага («сжатая» или двухбайтовая), а само число символов и заголовок строки целиком в одной записи.
function readSst(chunks: Buffer[]): string[] {
  let ci = 0;
  let pos = 8; // cstTotal, cstUnique
  const out: string[] = [];
  const unique = chunks[0].readUInt32LE(4);
  const need = (n: number) => {
    while (ci < chunks.length && pos + n > chunks[ci].length) {
      if (pos < chunks[ci].length) throw new XlsError("повреждённый файл");
      ci++;
      pos = 0;
    }
    if (ci >= chunks.length) throw new XlsError("повреждённый файл");
  };
  const skip = (n: number) => {
    while (n > 0) {
      if (ci >= chunks.length) throw new XlsError("повреждённый файл");
      const take = Math.min(n, chunks[ci].length - pos);
      pos += take;
      n -= take;
      if (n > 0) {
        ci++;
        pos = 0;
      }
    }
  };
  for (let s = 0; s < unique; s++) {
    need(3);
    const count = chunks[ci].readUInt16LE(pos);
    let flags = chunks[ci][pos + 2];
    pos += 3;
    let runs = 0;
    let extra = 0;
    if (flags & 8) {
      need(2);
      runs = chunks[ci].readUInt16LE(pos);
      pos += 2;
    }
    if (flags & 4) {
      need(4);
      extra = chunks[ci].readUInt32LE(pos);
      pos += 4;
    }
    let text = "";
    let left = count;
    while (left > 0) {
      if (ci >= chunks.length) throw new XlsError("повреждённый файл");
      const high = (flags & 1) !== 0;
      const available = Math.floor((chunks[ci].length - pos) / (high ? 2 : 1));
      if (available <= 0) {
        // Запись кончилась посреди строки: дальше идёт CONTINUE, и в его начале стоит байт флага.
        ci++;
        if (ci >= chunks.length) throw new XlsError("повреждённый файл");
        flags = chunks[ci][0];
        pos = 1;
        continue;
      }
      const take = Math.min(left, available);
      text += chars(chunks[ci], pos, take, high);
      pos += take * (high ? 2 : 1);
      left -= take;
    }
    skip(4 * runs + extra);
    out.push(text);
  }
  return out;
}

function rkValue(raw: number): number {
  const times100 = (raw & 1) !== 0;
  let value: number;
  if ((raw & 2) !== 0) {
    value = raw >> 2;
  } else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((raw & 0xfffffffc) >>> 0, 4);
    value = b.readDoubleLE(0);
  }
  return times100 ? value / 100 : value;
}

// Формат ячейки — дата или время? Встроенные номера: 14–17 — дата, 18–21 и 45–47 — время, 22 — дата со временем. У своих форматов смотрим на буквы дня, месяца, года
// (дата) и часа, секунд (время) вне кавычек и скобок; экранированные символы («\d») — просто знаки, не буквы формата.
type DateKind = { date: boolean; time: boolean };
function dateKind(id: number, custom: Map<number, string>): DateKind | null {
  if (id >= 14 && id <= 17) return { date: true, time: false };
  if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47)) return { date: false, time: true };
  if (id === 22) return { date: true, time: true };
  const code = custom.get(id);
  if (!code || /^general$/i.test(code.trim())) return null;
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  const date = /[dy]|m{3,}/i.test(bare);
  const time = /[hs]/i.test(bare);
  return date || time ? { date, time } : null;
}

function dateText(serial: number, date1904: boolean, kind: DateKind): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const moment = new Date(base + Math.round(serial * 86400000));
  const day = moment.toLocaleDateString("ru-RU", { timeZone: "UTC" });
  const time = moment.toLocaleTimeString("ru-RU", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
  if (!kind.time) return day;
  if (!kind.date) return time;
  return serial - Math.floor(serial) === 0 ? day : `${day} ${time}`;
}

const columnName = (col: number) => {
  let name = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

type SheetInfo = { name: string; state: number; type: number; at: number };

export function xlsText(buffer: Buffer): { text: string; map?: DocMap; hidden: string[] } {
  if (!isOle(buffer)) throw new XlsError("не файл Excel");
  let book: Buffer | undefined;
  try {
    const streams = readContainer(buffer);
    if (!streams.has("Workbook") && streams.has("Book")) throw new XlsError("это Excel 5.0/95 — пересохраните файл как .xlsx");
    book = streams.get("Workbook");
  } catch (error) {
    if (error instanceof XlsError) throw error;
    throw new XlsError("повреждённый файл");
  }
  if (!book) throw new XlsError("в файле нет книги Excel");

  // ——— Общая часть книги: листы, строки, форматы ячеек ———
  const sheets: SheetInfo[] = [];
  const xf: number[] = [];
  const formats = new Map<number, string>();
  let sst: string[] = [];
  let date1904 = false;
  let depth = 0;
  for (let rec = recordAt(book, 0); rec; rec = recordAt(book, rec.next)) {
    const { id, data } = rec;
    if (id === BOF) {
      if (depth === 0 && data.readUInt16LE(0) !== 0x0600) throw new XlsError("это Excel 5.0/95 — пересохраните файл как .xlsx");
      depth++;
    } else if (id === EOF) {
      if (--depth <= 0) break;
    } else if (id === FILEPASS) {
      throw new XlsError("файл защищён паролем");
    } else if (id === DATE1904) {
      date1904 = data.readUInt16LE(0) === 1;
    } else if (id === BOUNDSHEET) {
      sheets.push({ at: data.readUInt32LE(0), state: data[4] & 3, type: data[5], name: shortString(data, 6) });
    } else if (id === XF) {
      xf.push(data.readUInt16LE(2));
    } else if (id === FORMAT) {
      formats.set(data.readUInt16LE(0), longString(data, 2));
    } else if (id === SST) {
      const chunks = [data];
      let next = recordAt(book, rec.next);
      while (next && next.id === CONTINUE) {
        chunks.push(next.data);
        rec = next;
        next = recordAt(book, next.next);
      }
      sst = readSst(chunks);
    }
  }

  // ——— Листы ———
  const out: SheetData[] = [];
  for (const info of sheets) {
    if (info.type !== 0) continue; // диаграммы и макросы — не таблицы
    const cells = new Map<number, Map<number, string>>();
    const hiddenRows = new Set<number>();
    const hiddenCols = new Set<number>();
    const put = (row: number, col: number, text: string) => {
      const clean = cleanText(text);
      if (!clean) return;
      if (!cells.has(row)) cells.set(row, new Map());
      cells.get(row)!.set(col, clean);
    };
    const number = (row: number, col: number, ixfe: number, value: number) => {
      const kind = dateKind(xf[ixfe] ?? 0, formats);
      put(row, col, kind && value > 0 ? dateText(value, date1904, kind) : numberText(value));
    };
    let formulaAt: [number, number] | null = null;
    let level = 0;
    for (let rec = recordAt(book, info.at); rec; rec = recordAt(book, rec.next)) {
      const { id, data } = rec;
      if (id === BOF) {
        level++;
        continue;
      }
      if (id === EOF) {
        if (--level <= 0) break;
        continue;
      }
      if (level !== 1) continue; // вложенные части листа (диаграммы) пропускаем
      if (id === ROW) {
        if (data.readUInt16LE(12) & 0x20) hiddenRows.add(data.readUInt16LE(0));
      } else if (id === COLINFO) {
        if (data.readUInt16LE(8) & 1) for (let c = data.readUInt16LE(0); c <= Math.min(data.readUInt16LE(2), 255); c++) hiddenCols.add(c);
      } else if (id === LABELSST) {
        put(data.readUInt16LE(0), data.readUInt16LE(2), sst[data.readUInt32LE(6)] ?? "");
      } else if (id === LABEL) {
        put(data.readUInt16LE(0), data.readUInt16LE(2), longString(data, 6));
      } else if (id === NUMBER) {
        number(data.readUInt16LE(0), data.readUInt16LE(2), data.readUInt16LE(4), data.readDoubleLE(6));
      } else if (id === RK) {
        number(data.readUInt16LE(0), data.readUInt16LE(2), data.readUInt16LE(4), rkValue(data.readUInt32LE(6)));
      } else if (id === MULRK) {
        const row = data.readUInt16LE(0);
        const first = data.readUInt16LE(2);
        for (let k = 0; 4 + (k + 1) * 6 + 2 <= data.length; k++) {
          const at = 4 + k * 6;
          number(row, first + k, data.readUInt16LE(at), rkValue(data.readUInt32LE(at + 2)));
        }
      } else if (id === FORMULA) {
        const row = data.readUInt16LE(0);
        const col = data.readUInt16LE(2);
        // Результат — 8 байт: число, а при 0xFFFF в конце — строка (придёт записью STRING), логическое, ошибка или пусто.
        if (data.readUInt16LE(12) === 0xffff) {
          if (data[6] === 0) formulaAt = [row, col];
          else if (data[6] === 1) put(row, col, data[8] ? "да" : "нет");
        } else {
          number(row, col, data.readUInt16LE(4), data.readDoubleLE(6));
        }
      } else if (id === STRING) {
        if (formulaAt) put(formulaAt[0], formulaAt[1], longString(data, 0));
        formulaAt = null;
      } else if (id === BOOLERR) {
        if (data[7] === 0) put(data.readUInt16LE(0), data.readUInt16LE(2), data[6] ? "да" : "нет");
      }
    }

    let maxCol = -1;
    for (const row of cells.values()) for (const col of row.keys()) if (col > maxCol) maxCol = col;
    const rows: SheetCell[][] = [];
    let hiddenWithText = 0;
    for (const row of [...cells.keys()].sort((a, b) => a - b)) {
      const line: SheetCell[] = [];
      for (let col = 0; col <= maxCol; col++) line.push({ text: cells.get(row)!.get(col) ?? "", address: `${columnName(col + 1)}${row + 1}`, col: col + 1 });
      rows.push(line);
      if (hiddenRows.has(row)) hiddenWithText++;
    }
    out.push({ name: info.name, visible: info.state === 0, rows, hiddenRows: hiddenWithText, hiddenCols: [...hiddenCols].map((c) => c + 1) });
  }
  return sheetsText(out);
}
