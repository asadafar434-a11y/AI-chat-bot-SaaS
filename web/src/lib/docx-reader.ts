import "server-only";
import { strFromU8, unzipSync } from "fflate";
import { TextBuilder, type DocMap } from "@/lib/doc-source";
import { elements, kid, kids, MAX_XML_CHARS, parseXml, val, type XEl } from "@/lib/ooxml";

// Word (.docx) читаем напрямую из файла, а не через пересказ текста, потому что нужно то, что пересказ теряет:
//   — таблицы строка за строкой («ячейка | ячейка | ячейка») с объединёнными ячейками, а не россыпью абзацев;
//   — номера пунктов, которые Word ставит сам («2.4.1.»): в самом тексте их нет, они считаются по нумерации;
//   — страницы по разметке Word, заголовки по стилю, надписи, сноски.
// Для каждого куска текста записывается адрес (lib/doc-source.ts). Не вышло — extract-text.ts читает файл по-старому.

export class DocxError extends Error {}

export type DocxResult = { text: string; map?: DocMap; stats: { paragraphs: number; tables: number; pages: number } };

const PARTS = new Set(["word/document.xml", "word/styles.xml", "word/numbering.xml", "word/footnotes.xml", "word/endnotes.xml"]);

// ---------- стили и нумерация ----------

type Style = { name: string; basedOn?: string; numId?: string; ilvl?: string; outline?: number };

function readStyles(root: XEl | undefined): Map<string, Style> {
  const out = new Map<string, Style>();
  for (const s of kids(root, "w:style")) {
    const id = s.attrs["w:styleId"];
    if (!id) continue;
    const pPr = kid(s, "w:pPr");
    const numPr = kid(pPr, "w:numPr");
    const outline = val(pPr, "w:outlineLvl");
    out.set(id, {
      name: val(s, "w:name") ?? "",
      basedOn: val(s, "w:basedOn"),
      numId: val(numPr, "w:numId"),
      ilvl: val(numPr, "w:ilvl"),
      ...(outline !== undefined && { outline: Number(outline) }),
    });
  }
  return out;
}

// Стиль и его родители — от самого стиля вверх.
function* chainOf(styles: Map<string, Style>, id: string | undefined): Generator<[string, Style]> {
  const seen = new Set<string>();
  for (let cur = id; cur && !seen.has(cur) && seen.size < 12; ) {
    seen.add(cur);
    const style = styles.get(cur);
    if (!style) return;
    yield [cur, style];
    cur = style.basedOn;
  }
}

type Level = { start: number; fmt: string; text: string; lgl: boolean; pStyle?: string; restart?: number };

const ROMAN: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
const RUSSIAN = "абвгдежзиклмнопрстуфхцчшщэюя";

// Как Word пишет номер: «3», «03», «в», «iv», «IV»; незнакомое начертание — обычным числом.
function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case "decimalZero":
      return String(n).padStart(2, "0");
    case "lowerLetter":
    case "upperLetter": {
      const ch = String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
      return fmt === "upperLetter" ? ch.toUpperCase() : ch;
    }
    case "russianLower":
    case "russianUpper": {
      const ch = RUSSIAN[(n - 1) % RUSSIAN.length].repeat(Math.floor((n - 1) / RUSSIAN.length) + 1);
      return fmt === "russianUpper" ? ch.toUpperCase() : ch;
    }
    case "lowerRoman":
      return romanOf(n);
    case "upperRoman":
      return romanOf(n).toUpperCase();
    default:
      return String(n);
  }
}

function romanOf(n: number): string {
  let rest = Math.min(Math.max(Math.round(n), 1), 3999);
  let out = "";
  for (const [v, s] of ROMAN) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

// Счётчики нумерации, как их ведёт Word: у каждого списка (определения нумерации) свои счётчики по уровням;
// следующий пункт увеличивает свой уровень и сбрасывает вложенные.
class Numbering {
  private abstracts = new Map<string, Level[]>();
  private nums = new Map<string, { abstractId: string; overrides: Map<number, number> }>();
  private counters = new Map<string, (number | undefined)[]>();
  private started = new Set<string>();

  constructor(root: XEl | undefined) {
    for (const abs of kids(root, "w:abstractNum")) {
      const id = abs.attrs["w:abstractNumId"];
      const levels: Level[] = [];
      for (const lvl of kids(abs, "w:lvl")) {
        const restart = val(lvl, "w:lvlRestart");
        levels[Number(lvl.attrs["w:ilvl"] ?? 0)] = {
          start: Number(val(lvl, "w:start") ?? 1),
          fmt: val(lvl, "w:numFmt") ?? "decimal",
          text: val(lvl, "w:lvlText") ?? "",
          lgl: Boolean(kid(lvl, "w:isLgl")),
          pStyle: val(lvl, "w:pStyle"),
          ...(restart !== undefined && { restart: Number(restart) }),
        };
      }
      if (id !== undefined) this.abstracts.set(id, levels);
    }
    for (const num of kids(root, "w:num")) {
      const id = num.attrs["w:numId"];
      const abstractId = val(num, "w:abstractNumId");
      if (id === undefined || abstractId === undefined) continue;
      const overrides = new Map<number, number>();
      for (const o of kids(num, "w:lvlOverride")) {
        const start = val(o, "w:startOverride");
        if (start !== undefined) overrides.set(Number(o.attrs["w:ilvl"] ?? 0), Number(start));
      }
      this.nums.set(id, { abstractId, overrides });
    }
  }

  // Уровень списка, привязанный к стилю абзаца (у заголовков «Заголовок 2» — второй уровень).
  levelOfStyle(numId: string, styleId: string): number | undefined {
    const levels = this.abstracts.get(this.nums.get(numId)?.abstractId ?? "");
    const at = levels?.findIndex((l) => l?.pStyle === styleId);
    return at !== undefined && at >= 0 ? at : undefined;
  }

  // Номер пункта, например «2.4.1.»; null — у абзаца маркер, а не номер.
  label(numId: string, ilvl: number): string | null {
    const num = this.nums.get(numId);
    const levels = num && this.abstracts.get(num.abstractId);
    const level = levels?.[ilvl];
    if (!num || !levels || !level) return null;

    const counters = this.counters.get(num.abstractId) ?? [];
    this.counters.set(num.abstractId, counters);
    // Список начали заново с другого числа («начать с 5»): первый раз, когда он встретился.
    if (!this.started.has(numId)) {
      this.started.add(numId);
      for (const [lvl, start] of num.overrides) {
        counters[lvl] = start - 1;
        for (let j = lvl + 1; j < counters.length; j++) counters[j] = undefined;
      }
    }
    counters[ilvl] = (counters[ilvl] ?? level.start - 1) + 1;
    for (let j = ilvl + 1; j < levels.length; j++) {
      const restart = levels[j]?.restart;
      // restart 0 — не сбрасывать; число — сбрасывать, когда растёт уровень не ниже этого номера.
      if (restart === undefined || (restart !== 0 && ilvl <= restart - 1)) counters[j] = undefined;
    }

    if (level.fmt === "bullet" || level.fmt === "none" || !level.text.includes("%")) return null;
    const text = level.text.replace(/%([1-9])/g, (_, d: string) => {
      const at = Number(d) - 1;
      const lv = levels[at];
      if (!lv) return "";
      return formatNumber(counters[at] ?? lv.start, level.lgl && lv.fmt !== "bullet" ? "decimal" : lv.fmt);
    });
    return text.trim() || null;
  }
}

// ---------- обход документа ----------

type Mode = "rendered" | "explicit" | "none";

type Ctx = {
  b: TextBuilder;
  styles: Map<string, Style>;
  numbering: Numbering;
  mode: Mode;
  page: number;
  tables: number;
  paragraphs: number;
};

type Para = {
  label: string | null;
  segments: { text: string; page: number }[];
  boxes: XEl[];
  headStyle: boolean;
  bold: boolean;
  sectionBreak: boolean;
};

const off = (el: XEl | undefined) => !!el && ["0", "false", "off"].includes(el.attrs["w:val"] ?? "");

// Надписи и фигуры с текстом: у Word они записаны дважды (современным способом и для старых программ) — берём один раз.
function chosen(alt: XEl): XEl | undefined {
  return kid(alt, "mc:Choice") ?? kid(alt, "mc:Fallback");
}

function boxesIn(el: XEl, out: XEl[], depth = 0): void {
  if (depth > 60) return;
  for (const k of elements(el)) {
    if (k.name === "w:txbxContent") out.push(k);
    else if (k.name === "mc:AlternateContent") {
      const c = chosen(k);
      if (c) boxesIn(c, out, depth + 1);
    } else boxesIn(k, out, depth + 1);
  }
}

function readParagraph(p: XEl, ctx: Ctx): Para {
  const pPr = kid(p, "w:pPr");
  const styleId = val(pPr, "w:pStyle");
  const para: Para = { label: null, segments: [], boxes: [], headStyle: false, bold: true, sectionBreak: false };

  // Заголовок — по стилю («Заголовок 2», «Title») или по уровню структуры.
  const ownOutline = val(pPr, "w:outlineLvl");
  for (const [, style] of chainOf(ctx.styles, styleId)) {
    const level = /^(?:heading|заголовок)\s*(\d)/i.exec(style.name);
    if (level || /^(?:title|название)$/i.test(style.name) || (ownOutline === undefined && style.outline !== undefined && style.outline <= 2)) {
      para.headStyle = true;
      break;
    }
  }
  if (ownOutline !== undefined && Number(ownOutline) <= 2) para.headStyle = true;

  // Номер пункта: в самом абзаце или в его стиле (у заголовков он чаще всего там).
  let numId = val(kid(pPr, "w:numPr"), "w:numId");
  let ilvl = val(kid(pPr, "w:numPr"), "w:ilvl");
  if (numId === undefined) {
    for (const [, style] of chainOf(ctx.styles, styleId)) {
      if (style.numId === undefined) continue;
      numId = style.numId;
      if (ilvl === undefined && style.ilvl !== undefined) ilvl = style.ilvl;
      // Уровень — тот, что список привязал к стилю абзаца (или к его родителю): у «Заголовок 2» это второй уровень.
      if (ilvl === undefined && numId !== "0") {
        for (const [id] of chainOf(ctx.styles, styleId)) {
          const linked = ctx.numbering.levelOfStyle(numId, id);
          if (linked !== undefined) {
            ilvl = String(linked);
            break;
          }
        }
      }
      break;
    }
  }
  ilvl ??= "0";
  const label = numId && numId !== "0" ? ctx.numbering.label(numId, Number(ilvl) || 0) : null;
  para.label = label;

  const explicit = ctx.mode === "explicit";
  let cur = { text: "", page: ctx.page };
  const pageBreak = () => {
    if (cur.text) para.segments.push(cur);
    ctx.page++;
    cur = { text: "", page: ctx.page };
  };
  if (explicit && kid(pPr, "w:pageBreakBefore")) pageBreak();

  const run = (r: XEl, depth: number) => {
    let hasText = false;
    for (const c of elements(r)) {
      switch (c.name) {
        case "w:t": {
          const t = c.kids.map((k) => (typeof k === "string" ? k : "")).join("");
          cur.text += t;
          if (t.trim()) hasText = true;
          break;
        }
        case "w:tab":
        case "w:ptab":
          cur.text += "\t";
          break;
        case "w:br": {
          const type = c.attrs["w:type"];
          if (type === "page") {
            if (explicit) pageBreak();
          } else if (type !== "column") cur.text += "\n";
          break;
        }
        case "w:cr":
          cur.text += "\n";
          break;
        case "w:noBreakHyphen":
          cur.text += "-";
          break;
        case "w:lastRenderedPageBreak":
          if (ctx.mode === "rendered") pageBreak();
          break;
        case "w:drawing":
        case "w:pict":
        case "w:object":
          boxesIn(c, para.boxes);
          break;
        case "mc:AlternateContent": {
          const ch = chosen(c);
          if (ch && depth < 20) run(ch, depth + 1);
          break;
        }
        default:
          break;
      }
    }
    // Заголовок «жирным»: весь текст абзаца набран полужирным.
    if (hasText) {
      const bold = kid(kid(r, "w:rPr"), "w:b");
      if (!bold || off(bold)) para.bold = false;
    }
  };

  const inline = (el: XEl, depth: number) => {
    if (depth > 60) return;
    for (const c of elements(el)) {
      switch (c.name) {
        case "w:r":
          run(c, 0);
          break;
        case "w:hyperlink":
        case "w:ins":
        case "w:smartTag":
        case "w:fldSimple":
        case "w:customXml":
        case "w:moveTo":
          inline(c, depth + 1);
          break;
        case "w:sdt": {
          const content = kid(c, "w:sdtContent");
          if (content) inline(content, depth + 1);
          break;
        }
        case "mc:AlternateContent": {
          const ch = chosen(c);
          if (ch) inline(ch, depth + 1);
          break;
        }
        default:
          break;
      }
    }
  };
  inline(p, 0);
  if (cur.text) para.segments.push(cur);

  // Раздел, который начинается с новой страницы, закончился на этом абзаце.
  const sect = kid(pPr, "w:sectPr");
  if (explicit && sect && val(sect, "w:type") !== "continuous") para.sectionBreak = true;
  ctx.paragraphs++;
  return para;
}

const trimEnds = (s: string) => s.replace(/^\s+|\s+$/g, "");

// Абзац вне таблицы: текст с номером пункта и адресом; заголовки отмечаются в карте.
function emitParagraph(p: XEl, ctx: Ctx): void {
  const para = readParagraph(p, ctx);
  const pieces = para.segments.filter((s) => s.text.trim() !== "");
  if (pieces.length) {
    const whole = trimEnds(pieces.map((s) => s.text).join(""));
    const words = whole.split(/\s+/);
    const heading =
      para.headStyle ||
      (para.bold && whole.length >= 3 && whole.length <= 150 && !/[:;,!?]$/.test(whole) && (words.length >= 2 || Boolean(para.label)));
    pieces.forEach((seg, k) => {
      let text = seg.text;
      if (k === 0) text = (para.label ? `${para.label} ` : "") + text.replace(/^\s+/, "");
      if (k === pieces.length - 1) text = text.replace(/\s+$/, "");
      ctx.b.add(text, { ...pageRef(ctx, seg.page), ...(heading && { head: true as const }) });
    });
    ctx.b.raw("\n\n");
  } else if (para.label) {
    // Только номер, текста нет: так бывает у номеров строк таблицы и у пункта, содержимое которого — в таблице ниже.
    ctx.b.add(para.label, pageRef(ctx, ctx.page));
    ctx.b.raw("\n\n");
  }
  if (para.sectionBreak) ctx.page++;
  for (const box of para.boxes) blocks(box, ctx);
}

const pageRef = (ctx: Ctx, page: number) => (ctx.mode === "none" ? {} : { page });

// Текст абзаца внутри ячейки или сноски: без заголовков и адресов, но с номером пункта.
function paragraphText(p: XEl, ctx: Ctx): string {
  const para = readParagraph(p, ctx);
  const text = trimEnds(para.segments.map((s) => s.text).join(""));
  const full = para.label ? (text ? `${para.label} ${text}` : para.label) : text;
  if (para.sectionBreak) ctx.page++;
  // Надпись внутри ячейки читается как её продолжение.
  const inner = para.boxes.map((box) => cellText(box, ctx)).filter(Boolean);
  return [full, ...inner].filter(Boolean).join(" ");
}

// Всё, что лежит в ячейке: абзацы, вложенные таблицы — одной строкой с пробелами.
function cellText(container: XEl, ctx: Ctx, depth = 0): string {
  if (depth > 20) return "";
  const parts: string[] = [];
  for (const k of elements(container)) {
    if (k.name === "w:p") parts.push(paragraphText(k, ctx));
    else if (k.name === "w:tbl") {
      for (const tr of kids(k, "w:tr")) for (const tc of kids(tr, "w:tc")) parts.push(cellText(tc, ctx, depth + 1));
    } else if (k.name === "w:sdt") {
      const content = kid(k, "w:sdtContent");
      if (content) parts.push(cellText(content, ctx, depth + 1));
    }
  }
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function emitTable(tbl: XEl, ctx: Ctx): void {
  const no = ++ctx.tables;
  kids(tbl, "w:tr").forEach((tr, r) => {
    const row = r + 1;
    let col = 1;
    const cells: { text: string; col: number; page: number }[] = [];
    for (const tc of kids(tr, "w:tc")) {
      const tcPr = kid(tc, "w:tcPr");
      const span = Math.max(1, Number(val(tcPr, "w:gridSpan") ?? 1) || 1);
      const merge = kid(tcPr, "w:vMerge");
      // Продолжение объединения по вертикали: текст стоит в ячейке выше.
      const continued = !!merge && (merge.attrs["w:val"] ?? "continue") === "continue";
      const page = ctx.page;
      cells.push({ text: continued ? "" : cellText(tc, ctx), col, page });
      col += span;
    }
    let last = cells.length - 1;
    while (last >= 0 && !cells[last].text) last--;
    cells.slice(0, last + 1).forEach((cell, k) => {
      if (k > 0) ctx.b.raw(" | ");
      ctx.b.add(cell.text, { ...pageRef(ctx, cell.page), table: no, row, col: cell.col });
    });
    if (last >= 0) ctx.b.raw("\n");
  });
  ctx.b.raw("\n");
}

// Содержимое документа, надписи или сноски: абзацы и таблицы по порядку.
function blocks(container: XEl, ctx: Ctx, depth = 0): void {
  if (depth > 40) return;
  for (const k of elements(container)) {
    switch (k.name) {
      case "w:p":
        emitParagraph(k, ctx);
        break;
      case "w:tbl":
        emitTable(k, ctx);
        break;
      case "w:sdt": {
        const content = kid(k, "w:sdtContent");
        if (content) blocks(content, ctx, depth + 1);
        break;
      }
      case "mc:AlternateContent": {
        const ch = chosen(k);
        if (ch) blocks(ch, ctx, depth + 1);
        break;
      }
      case "w:customXml":
      case "w:ins":
      case "w:smartTag":
        blocks(k, ctx, depth + 1);
        break;
      default:
        break;
    }
  }
}

// Сноски в конце документа: «Сноски» отдельным заголовком, дальше по порядку.
function emitNotes(root: XEl | undefined, name: string, title: string, ctx: Ctx): void {
  const notes = kids(root, name).filter((n) => !n.attrs["w:type"] && Number(n.attrs["w:id"] ?? 0) > 0);
  const lines = notes.map((n) => cellText(n, ctx)).filter(Boolean);
  if (!lines.length) return;
  ctx.b.add(title, { head: true });
  ctx.b.raw("\n\n");
  lines.forEach((line, i) => {
    ctx.b.add(`${i + 1}. ${line}`);
    ctx.b.raw("\n\n");
  });
}

// Страницы у Word бывают двух видов. Если файл сохранял сам Word, в нём отмечено, где кончилась каждая страница при
// последней вёрстке. Если нет — считаем явные разрывы страниц и разделов; ни тех, ни других — страниц не знаем.
function pageMode(xml: string): Mode {
  if (xml.includes("<w:lastRenderedPageBreak")) return "rendered";
  const explicit =
    (xml.match(/<w:br\b[^>]*\bw:type="page"/g)?.length ?? 0) + (xml.match(/<w:pageBreakBefore\b/g)?.length ?? 0) + Math.max(0, (xml.match(/<w:sectPr\b/g)?.length ?? 0) - 1);
  return explicit > 0 ? "explicit" : "none";
}

// Сколько знаков в тексте файла (без пробелов), если ничего не терять; дубли надписей не считаем, «&amp;» — один знак.
function textSize(xml: string): number {
  let n = 0;
  for (const m of xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "").matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)) {
    n += m[1].replace(/&(?:#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, "x").replace(/\s+/g, "").length;
  }
  return n;
}

export function readDocx(data: Uint8Array): DocxResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) => {
        if (!PARTS.has(f.name)) return false;
        if (f.originalSize > MAX_XML_CHARS) throw new DocxError("часть документа слишком велика");
        return true;
      },
    });
  } catch (e) {
    throw e instanceof DocxError ? e : new DocxError("не архив Word");
  }
  const part = (name: string) => (files[name] ? strFromU8(files[name]) : undefined);
  const documentXml = part("word/document.xml");
  if (!documentXml) throw new DocxError("в файле нет word/document.xml");

  try {
    const root = parseXml(documentXml);
    const body = kid(root, "w:body");
    if (!body) throw new DocxError("в документе нет тела");
    const opt = (name: string) => {
      const xml = part(name);
      return xml ? parseXml(xml) : undefined;
    };
    const mode = pageMode(documentXml);
    const ctx: Ctx = {
      b: new TextBuilder(),
      styles: readStyles(opt("word/styles.xml")),
      numbering: new Numbering(opt("word/numbering.xml")),
      mode,
      page: 1,
      tables: 0,
      paragraphs: 0,
    };
    blocks(body, ctx);
    emitNotes(opt("word/footnotes.xml"), "w:footnote", "Сноски", ctx);
    emitNotes(opt("word/endnotes.xml"), "w:endnote", "Концевые сноски", ctx);

    const { text, map } = ctx.b.build(mode !== "none");
    // Прочитано заметно меньше, чем есть в файле, — что-то в разметке нашему чтению незнакомо: пусть читает прежний способ.
    if (text.replace(/\s+/g, "").length < textSize(documentXml) * 0.9) throw new DocxError("прочитана не вся разметка");
    return { text, map, stats: { paragraphs: ctx.paragraphs, tables: ctx.tables, pages: mode === "none" ? 0 : ctx.page } };
  } catch (e) {
    if (e instanceof DocxError) throw e;
    throw new DocxError(`разбор документа не удался: ${(e as Error).message}`);
  }
}
