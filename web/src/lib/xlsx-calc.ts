// Пересчёт формул Excel-бланка (lib/xlsx-form.ts): после того как в файл вписаны цены, в нём остаются старые результаты формул. Здесь формулы считаются заново —
// чтобы показать участнику итог до открытия Excel и сверить его с ценой и НМЦ. Читается небольшая часть языка формул, которая стоит в бланках заказчиков:
// числа, ссылки и диапазоны (и на другие листы), + − * / ^ & сравнения %, SUM, PRODUCT, SUMPRODUCT, AVERAGE, MIN, MAX, COUNT, ROUND, ROUNDUP, ROUNDDOWN, INT, ABS,
// IF, IFERROR, AND, OR, NOT, STDEV. Незнакомая функция — ошибка «#NAME?»: итог не показывается, ничего не выдумывается. Модуль без зависимостей от браузера и сервера.
import { parseRef, refOf, type FormBook, type FormCell, type FormSheet } from "@/lib/xlsx-form";

export type CalcError = { error: string };
export type CalcValue = number | string | boolean | null | CalcError;
export const isCalcError = (v: CalcValue): v is CalcError => typeof v === "object" && v !== null;
const err = (code: string): CalcError => ({ error: code });

// ---------- разбор формулы ----------

type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: string }
  | { t: "ref"; sheet?: string; a: string; b?: string }
  | { t: "un"; op: "-" | "+"; x: Node }
  | { t: "pct"; x: Node }
  | { t: "bin"; op: string; l: Node; r: Node }
  | { t: "fn"; name: string; args: Node[] };

type Tok = { k: "num" | "str" | "ref" | "name" | "fn" | "op" | "err"; v: string; sheet?: string };

const CELL = String.raw`\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?`;
const TOKEN = new RegExp(
  String.raw`\s*(?:(?<str>"(?:[^"]|"")*")|(?<err>#[A-Z/0!?]+)|(?:(?<sheet>'(?:[^']|'')+'|[A-Za-zА-Яа-яЁё0-9_.]+)!)?(?<ref>${CELL})(?![\dA-Za-z_(])|(?<num>\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|(?<fn>[A-Za-z_][A-Za-z0-9_.]*)(?=\()|(?<name>[A-Za-z_][A-Za-z0-9_.]*)|(?<op><>|<=|>=|[=<>+\-*/^&%(),;]))`,
  "y",
);

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < text.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(text);
    if (!m || !m.groups) {
      if (/^\s*$/.test(text.slice(pos))) break;
      throw new Error("не разобрать формулу");
    }
    pos = TOKEN.lastIndex;
    const g = m.groups;
    if (g.str !== undefined) out.push({ k: "str", v: g.str.slice(1, -1).replace(/""/g, '"') });
    else if (g.err !== undefined) out.push({ k: "err", v: g.err });
    else if (g.ref !== undefined) out.push({ k: "ref", v: g.ref.replace(/\$/g, ""), sheet: g.sheet ? g.sheet.replace(/^'|'$/g, "").replace(/''/g, "'") : undefined });
    else if (g.num !== undefined) out.push({ k: "num", v: g.num });
    else if (g.fn !== undefined) out.push({ k: "fn", v: g.fn.toUpperCase().replace(/^_XLFN\./, "") });
    else if (g.name !== undefined) out.push({ k: "name", v: g.name.toUpperCase() });
    else out.push({ k: "op", v: g.op });
  }
  return out;
}

function parse(text: string): Node {
  const toks = tokenize(text);
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const isOp = (v: string) => peek()?.k === "op" && peek().v === v;

  const primary = (): Node => {
    const t = take();
    if (!t) throw new Error("формула оборвана");
    if (t.k === "num") return { t: "num", v: Number(t.v) };
    if (t.k === "str") return { t: "str", v: t.v };
    if (t.k === "err") return { t: "err", v: t.v };
    if (t.k === "ref") {
      const [a, b] = t.v.split(":");
      return { t: "ref", sheet: t.sheet, a, b };
    }
    if (t.k === "name") {
      if (t.v === "TRUE") return { t: "bool", v: true };
      if (t.v === "FALSE") return { t: "bool", v: false };
      return { t: "err", v: "#NAME?" };
    }
    if (t.k === "fn") {
      if (!isOp("(")) throw new Error("после имени функции нет скобки");
      take();
      const args: Node[] = [];
      if (isOp(")")) {
        take();
        return { t: "fn", name: t.v, args };
      }
      for (;;) {
        // Пропущенный аргумент («IF(A1;;1)») — пусто.
        args.push(isOp(",") || isOp(";") || isOp(")") ? { t: "err", v: "#EMPTY" } : compare());
        if (isOp(",") || isOp(";")) {
          take();
          continue;
        }
        if (isOp(")")) {
          take();
          break;
        }
        throw new Error("в списке аргументов нет запятой или скобки");
      }
      return { t: "fn", name: t.v, args };
    }
    if (t.k === "op" && t.v === "(") {
      const inner = compare();
      if (!isOp(")")) throw new Error("нет закрывающей скобки");
      take();
      return inner;
    }
    throw new Error(`неожиданный знак «${t.v}»`);
  };
  const percent = (): Node => {
    let n = primary();
    while (isOp("%")) {
      take();
      n = { t: "pct", x: n };
    }
    return n;
  };
  // В Excel унарный минус сильнее степени: −2^2 = 4.
  const unary = (): Node => {
    if (isOp("-") || isOp("+")) {
      const op = take().v as "-" | "+";
      return { t: "un", op, x: unary() };
    }
    return percent();
  };
  const power = (): Node => {
    let l = unary();
    while (isOp("^")) {
      take();
      l = { t: "bin", op: "^", l, r: unary() };
    }
    return l;
  };
  const level = (ops: string[], next: () => Node) => (): Node => {
    let l = next();
    while (peek()?.k === "op" && ops.includes(peek().v)) {
      const op = take().v;
      l = { t: "bin", op, l, r: next() };
    }
    return l;
  };
  const mul = level(["*", "/"], power);
  const add = level(["+", "-"], mul);
  const concat = level(["&"], add);
  const compare = level(["=", "<>", "<", ">", "<=", ">="], concat);

  const node = compare();
  if (i < toks.length) throw new Error(`лишнее в конце формулы: «${toks[i].v}»`);
  return node;
}

// ---------- вычисление ----------

type R = { v: CalcValue; d: boolean };
type RangeValues = { cells: CalcValue[]; d: boolean };

export type Overrides = Map<string, number | string>;
const keyOf = (sheet: string, ref: string) => `${sheet}!${ref}`;

function num(v: CalcValue): number | CalcError {
  if (isCalcError(v)) return v;
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  const t = v.trim().replace(",", ".");
  return t !== "" && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t) ? Number(t) : err("#VALUE!");
}

const roundTo = (x: number, digits: number, mode: "half" | "up" | "down"): number => {
  const f = 10 ** digits;
  const scaled = Math.abs(x) * f * (1 + Number.EPSILON);
  const r = mode === "half" ? Math.round(scaled) : mode === "up" ? Math.ceil(scaled - 1e-9) : Math.floor(scaled + 1e-9);
  return (Math.sign(x) * r) / f;
};

export class Calc {
  private readonly memo = new Map<string, R>();
  private readonly busy = new Set<string>();
  private readonly byName: Map<string, FormSheet>;
  private readonly overrides: Overrides;

  constructor(book: FormBook, overrides: Overrides = new Map()) {
    this.overrides = overrides;
    this.byName = new Map(book.sheets.map((s) => [s.name.toLowerCase(), s]));
  }

  /** Значение ячейки и признак «зависит от того, что вписали»: переопределённая ячейка или формула, где такая встречается. */
  cell(sheetName: string, ref: string): R {
    const key = keyOf(sheetName, ref);
    const own = this.overrides.get(key);
    if (own !== undefined) return { v: own, d: true };
    const cached = this.memo.get(key);
    if (cached) return cached;
    const sheet = this.byName.get(sheetName.toLowerCase());
    const cell = sheet?.cells.get(ref);
    if (!sheet || !cell) return { v: null, d: false };
    if (!cell.ftext) return { v: this.plain(cell), d: false };
    if (this.busy.has(key)) return { v: err("#CIRC!"), d: false };
    this.busy.add(key);
    let result: R;
    try {
      result = this.run(parse(cell.ftext), sheet.name);
    } catch {
      result = { v: err("#NAME?"), d: false };
    }
    this.busy.delete(key);
    this.memo.set(key, result);
    return result;
  }

  private plain(cell: FormCell): CalcValue {
    if (cell.text === "") return null;
    if (cell.kind === "s") return cell.text;
    if (cell.kind === "b") return cell.text === "1";
    if (cell.kind === "e") return err(cell.text);
    const n = Number(cell.text);
    return Number.isFinite(n) ? n : cell.text;
  }

  private range(a: string, b: string, sheetName: string): RangeValues {
    const sheet = this.byName.get(sheetName.toLowerCase());
    const from = parseRef(a);
    const to = parseRef(b);
    const [r1, r2] = [Math.min(from.row, to.row), Math.max(from.row, to.row)];
    const [c1, c2] = [Math.min(from.col, to.col), Math.max(from.col, to.col)];
    const out: RangeValues = { cells: [], d: false };
    if (!sheet) return out;
    const area = (r2 - r1 + 1) * (c2 - c1 + 1);
    const refs: string[] = [];
    if (area <= sheet.cells.size) {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) refs.push(refOf(r, c));
    } else {
      for (const cell of sheet.cells.values()) if (cell.row >= r1 && cell.row <= r2 && cell.col >= c1 && cell.col <= c2) refs.push(cell.ref);
    }
    // Вписанные нами значения лежат и вне ячеек файла: они тоже в диапазоне.
    for (const key of this.overrides.keys()) {
      const [name, ref] = [key.slice(0, key.lastIndexOf("!")), key.slice(key.lastIndexOf("!") + 1)];
      if (name.toLowerCase() !== sheetName.toLowerCase() || refs.includes(ref)) continue;
      const p = parseRef(ref);
      if (p.row >= r1 && p.row <= r2 && p.col >= c1 && p.col <= c2) refs.push(ref);
    }
    for (const ref of refs) {
      const r = this.cell(sheet.name, ref);
      out.cells.push(r.v);
      out.d ||= r.d;
    }
    return out;
  }

  private run(node: Node, sheet: string): R {
    switch (node.t) {
      case "num":
      case "str":
      case "bool":
        return { v: node.v, d: false };
      case "err":
        return { v: node.v === "#EMPTY" ? null : err(node.v), d: false };
      case "ref": {
        const s = node.sheet ?? sheet;
        if (node.b) return { v: err("#VALUE!"), d: false };
        // Лист, которого нет в файле (ссылка на другую книгу «[1]Лист!D8»): значения мы не знаем — не подставляем пустое.
        if (!this.byName.has(s.toLowerCase())) return { v: err("#REF!"), d: false };
        return this.cell(s, node.a);
      }
      case "un": {
        const x = this.run(node.x, sheet);
        const n = num(x.v);
        return { v: isCalcError(n) ? n : node.op === "-" ? -n : n, d: x.d };
      }
      case "pct": {
        const x = this.run(node.x, sheet);
        const n = num(x.v);
        return { v: isCalcError(n) ? n : n / 100, d: x.d };
      }
      case "bin":
        return this.binary(node, sheet);
      case "fn":
        return this.call(node.name, node.args, sheet);
    }
  }

  private binary(node: Extract<Node, { t: "bin" }>, sheet: string): R {
    const l = this.run(node.l, sheet);
    const r = this.run(node.r, sheet);
    const d = l.d || r.d;
    if (isCalcError(l.v)) return { v: l.v, d };
    if (isCalcError(r.v)) return { v: r.v, d };
    if (node.op === "&") return { v: `${l.v ?? ""}${r.v ?? ""}`, d };
    if (["=", "<>", "<", ">", "<=", ">="].includes(node.op)) return { v: compareValues(l.v, r.v, node.op), d };
    const a = num(l.v);
    const b = num(r.v);
    if (isCalcError(a)) return { v: a, d };
    if (isCalcError(b)) return { v: b, d };
    switch (node.op) {
      case "+":
        return { v: a + b, d };
      case "-":
        return { v: a - b, d };
      case "*":
        return { v: a * b, d };
      case "/":
        return { v: b === 0 ? err("#DIV/0!") : a / b, d };
      default:
        return { v: a ** b, d };
    }
  }

  // Аргументы-диапазоны разворачиваются в числа; одиночные значения считаются как написаны.
  private numbers(args: Node[], sheet: string): { values: number[]; d: boolean; error?: CalcError } {
    const values: number[] = [];
    let d = false;
    for (const arg of args) {
      if (arg.t === "ref" && arg.b) {
        const r = this.range(arg.a, arg.b, arg.sheet ?? sheet);
        d ||= r.d;
        for (const v of r.cells) {
          if (isCalcError(v)) return { values, d, error: v };
          if (typeof v === "number") values.push(v);
        }
      } else {
        const r = this.run(arg, sheet);
        d ||= r.d;
        if (isCalcError(r.v)) return { values, d, error: r.v };
        if (arg.t === "ref" && (typeof r.v !== "number" || r.v === null)) continue;
        const n = num(r.v);
        if (isCalcError(n)) return { values, d, error: n };
        values.push(n);
      }
    }
    return { values, d };
  }

  private call(name: string, args: Node[], sheet: string): R {
    const fold = (f: (xs: number[]) => number | CalcError): R => {
      const { values, d, error } = this.numbers(args, sheet);
      return { v: error ?? f(values), d };
    };
    const one = (i: number): R => (args[i] ? this.run(args[i], sheet) : { v: null, d: false });
    switch (name) {
      case "SUM":
        return fold((xs) => xs.reduce((s, x) => s + x, 0));
      case "PRODUCT":
        return fold((xs) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s * x, 1)));
      case "AVERAGE":
        return fold((xs) => (xs.length === 0 ? err("#DIV/0!") : xs.reduce((s, x) => s + x, 0) / xs.length));
      case "MIN":
        return fold((xs) => (xs.length === 0 ? 0 : Math.min(...xs)));
      case "MAX":
        return fold((xs) => (xs.length === 0 ? 0 : Math.max(...xs)));
      case "COUNT":
        return fold((xs) => xs.length);
      case "STDEV":
      case "STDEV.S":
        return fold((xs) => {
          if (xs.length < 2) return err("#DIV/0!");
          const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
          return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1));
        });
      case "SUMPRODUCT": {
        const lists = args.map((a) => (a.t === "ref" && a.b ? this.range(a.a, a.b, a.sheet ?? sheet) : null));
        if (lists.some((l) => l === null) || lists.length === 0) return { v: err("#VALUE!"), d: false };
        const ranges = lists as RangeValues[];
        const size = ranges[0].cells.length;
        if (ranges.some((r) => r.cells.length !== size)) return { v: err("#VALUE!"), d: false };
        const d = ranges.some((r) => r.d);
        let sum = 0;
        for (let i = 0; i < size; i++) {
          let p = 1;
          for (const r of ranges) {
            const v = r.cells[i];
            if (isCalcError(v)) return { v, d };
            p *= typeof v === "number" ? v : 0;
          }
          sum += p;
        }
        return { v: sum, d };
      }
      case "ROUND":
      case "ROUNDUP":
      case "ROUNDDOWN": {
        const x = one(0);
        const digits = one(1);
        const a = num(x.v);
        const b = num(digits.v);
        const d = x.d || digits.d;
        if (isCalcError(a)) return { v: a, d };
        if (isCalcError(b)) return { v: b, d };
        return { v: roundTo(a, Math.trunc(b), name === "ROUND" ? "half" : name === "ROUNDUP" ? "up" : "down"), d };
      }
      case "INT": {
        const x = one(0);
        const a = num(x.v);
        return { v: isCalcError(a) ? a : Math.floor(a), d: x.d };
      }
      case "ABS": {
        const x = one(0);
        const a = num(x.v);
        return { v: isCalcError(a) ? a : Math.abs(a), d: x.d };
      }
      case "IF": {
        const c = one(0);
        if (isCalcError(c.v)) return c;
        const truth = typeof c.v === "string" ? c.v !== "" : Boolean(c.v);
        const branch = truth ? one(1) : args[2] ? one(2) : { v: false as CalcValue, d: false };
        return { v: branch.v, d: c.d || branch.d };
      }
      case "IFERROR": {
        const a = one(0);
        if (!isCalcError(a.v)) return a;
        const b = one(1);
        return { v: b.v, d: a.d || b.d };
      }
      case "AND":
      case "OR": {
        let d = false;
        const flags: boolean[] = [];
        for (const arg of args) {
          const r = this.run(arg, sheet);
          d ||= r.d;
          if (isCalcError(r.v)) return { v: r.v, d };
          flags.push(typeof r.v === "string" ? r.v !== "" : Boolean(r.v));
        }
        return { v: name === "AND" ? flags.every(Boolean) : flags.some(Boolean), d };
      }
      case "NOT": {
        const x = one(0);
        return { v: isCalcError(x.v) ? x.v : !x.v, d: x.d };
      }
      default:
        return { v: err("#NAME?"), d: false };
    }
  }
}

function compareValues(a: CalcValue, b: CalcValue, op: string): boolean {
  const rank = (v: CalcValue) => (typeof v === "number" || v === null ? 0 : typeof v === "string" ? 1 : 2);
  const [x, y] = [a ?? (typeof b === "string" ? "" : 0), b ?? (typeof a === "string" ? "" : 0)];
  let cmp: number;
  if (rank(x) !== rank(y)) cmp = rank(x) - rank(y);
  else if (typeof x === "string" && typeof y === "string") cmp = x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0;
  else cmp = Number(x) - Number(y);
  switch (op) {
    case "=":
      return cmp === 0;
    case "<>":
      return cmp !== 0;
    case "<":
      return cmp < 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    default:
      return cmp >= 0;
  }
}

// ---------- итоги бланка ----------

export type TotalItem = { sheet: string; ref: string; label: string; value: number };

// «Итого без НДС:», «Итоговая стоимость услуг за 1-ый год», «Стоимость заявки (цена Договора)…», «Всего»: итоги участника. Строки «НМЦ:» — расчёт заказчика, это не наша цена.
const TOTAL_LABEL = /итог|всего|общая\s+(?:сумма|стоимость)|стоимость\s+заявки|цена\s+(?:договора|контракта|предложения)/i;
const CUSTOMER_LABEL = /^нмц\b|начальн\S*\s+\(?максимальн/i;

/**
 * Итоги, которые изменились от того, что вписали: ячейка с подписью «Итого…» слева и числом справа, если число зависит от вписанных значений. Итоги заказчика
 * (его НМЦ) от вписанного не зависят и не показываются. Что не посчиталось (незнакомая функция), пропускается.
 */
export function totalsOf(book: FormBook, overrides: Overrides): TotalItem[] {
  if (overrides.size === 0) return [];
  const calc = new Calc(book, overrides);
  const out: TotalItem[] = [];
  for (const sheet of book.sheets) {
    if (sheet.hidden) continue;
    const rows = new Map<number, FormCell[]>();
    for (const cell of sheet.cells.values()) if (cell.text !== "" || cell.ftext) rows.set(cell.row, [...(rows.get(cell.row) ?? []), cell]);
    for (const [, cells] of [...rows].sort((a, b) => a[0] - b[0])) {
      cells.sort((a, b) => a.col - b.col);
      cells.forEach((label, i) => {
        if (label.formula || (label.kind === "n" && label.text !== "" && Number.isFinite(Number(label.text)))) return;
        const text = label.text.replace(/\s+/g, " ").trim();
        if (!TOTAL_LABEL.test(text) || CUSTOMER_LABEL.test(text) || text.length > 140) return;
        // Значение — первая формула правее до следующей подписи итога; пояснения между ними («С учётом 1/2 ИПЦ…») пропускаются.
        for (const cell of cells.slice(i + 1)) {
          if (!cell.formula && cell.kind === "s" && TOTAL_LABEL.test(cell.text)) break;
          if (!cell.formula) continue;
          const r = calc.cell(sheet.name, cell.ref);
          if (r.d && typeof r.v === "number" && Number.isFinite(r.v)) out.push({ sheet: sheet.name, ref: cell.ref, label: text.replace(/[:\s]+$/, ""), value: r.v });
          break;
        }
      });
    }
  }
  return out;
}
