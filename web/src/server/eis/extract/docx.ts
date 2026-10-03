/**
 * EIS Document Intelligence — извлечение из DOCX.
 *
 * Собственный walker поверх fflate + @/lib/ooxml (переиспользуется парсер,
 * НЕ дублируется): paragraphs / headings (по стилю) / lists / tables — строго
 * в порядке документа. Существующий readDocx (@/lib/docx-reader) даёт текст+карту,
 * но не упорядоченные блоки с типами — поэтому walker здесь, бизнес-логика чтения
 * заявок не тронута.
 *
 * Честное ограничение: у DOCX нет реальных страниц — все блоки лежат на
 * pageNumber=1, точный адрес — source.paragraph (порядковый номер абзаца).
 */

import { strFromU8, unzipSync } from "fflate";
import { elements, kid, kids, parseXml, type XEl } from "../../../lib/ooxml.ts";
import type { EisBlock, EisPage, EisTable } from "./types.ts";

export interface DocxExtractResult {
  pages: EisPage[];
  tables: EisTable[];
  truncated: boolean;
}

const MAX_BLOCKS_PER_DOC = 20000;

type ParaStyle = { name: string; outline?: number };

function readStyles(root: XEl | undefined): Map<string, ParaStyle> {
  const out = new Map<string, ParaStyle>();
  for (const s of kids(root, "w:style")) {
    const id = s.attrs["w:styleId"];
    if (!id) continue;
    const outlineRaw = kid(kid(s, "w:pPr"), "w:outlineLvl")?.attrs["w:val"];
    const nameEl = kid(s, "w:name");
    out.set(id, {
      name: nameEl?.attrs["w:val"] ?? "",
      ...(outlineRaw !== undefined && { outline: Number(outlineRaw) }),
    });
  }
  return out;
}

/** Текст ранов: w:t + табы/переносы; w:del пропускаем, w:ins читаем. */
function runText(el: XEl, state: { hasImage: boolean }): string {
  const parts: string[] = [];
  const walk = (node: XEl): void => {
    if (node.name === "w:t" || node.name === "w:delText") {
      parts.push(node.kids.filter((k): k is string => typeof k === "string").join(""));
    } else if (node.name === "w:tab") {
      parts.push("\t");
    } else if (node.name === "w:br" || node.name === "w:cr") {
      parts.push("\n");
    } else if (node.name === "w:noBreakHyphen") {
      parts.push("-");
    } else if (node.name === "w:drawing" || node.name === "w:pict") {
      state.hasImage = true;
    } else if (node.name === "w:del" || node.name === "w:delText") {
      return;
    } else {
      for (const child of elements(node)) walk(child);
    }
  };
  walk(el);
  return parts.join("");
}

function paraText(para: XEl, state: { hasImage: boolean }): string {
  return runText(para, state);
}

function cellText(cell: XEl, state: { hasImage: boolean }): string {
  return kids(cell, "w:p").map((p) => paraText(p, state)).join("\n");
}

function isHeading(styleId: string | undefined, styles: Map<string, ParaStyle>): { yes: boolean; level: number } {
  if (!styleId) return { yes: false, level: 0 };
  const seen = new Set<string>();
  let cur: string | undefined = styleId;
  while (cur && !seen.has(cur) && seen.size < 12) {
    seen.add(cur);
    const style = styles.get(cur);
    if (!style) break;
    if (/^heading\s*(\d+)?/i.test(style.name) || /^заголовок\s*(\d+)?/i.test(style.name)) {
      const m = style.name.match(/(\d+)\s*$/);
      return { yes: true, level: Math.min(6, Math.max(1, Number(m?.[1] ?? 1))) };
    }
    if (style.outline !== undefined && style.outline <= 5) return { yes: true, level: style.outline + 1 };
    // basedOn цепочку здесь не тянем (нужен полный разбор стилей как в docx-reader) —
    // фиксируем styleId в metadata через имя стиля.
    cur = undefined;
  }
  return { yes: false, level: 0 };
}

interface Walker {
  paraIndex: number;
  tableIndex: number;
  blockSeq: number;
  truncated: boolean;
  blocks: EisBlock[];
  tables: EisTable[];
  styles: Map<string, ParaStyle>;
}

function nextId(w: Walker): string {
  return `b${++w.blockSeq}`;
}

function pushBlock(w: Walker, block: Omit<EisBlock, "id">): void {
  if (w.blockSeq >= MAX_BLOCKS_PER_DOC) {
    w.truncated = true;
    return;
  }
  w.blocks.push({ ...block, id: nextId(w) });
}

function walkParagraph(w: Walker, para: XEl, extraType?: EisBlock["type"], extraSource?: Partial<EisBlock["source"]>): void {
  w.paraIndex++;
  const state = { hasImage: false };
  const text = paraText(para, state).replace(/[ \t]+\n/g, "\n").trim();
  const pPr = kid(para, "w:pPr");
  const styleId = kid(pPr, "w:pStyle")?.attrs["w:val"];
  const numPr = kid(pPr, "w:numPr");
  const heading = isHeading(styleId, w.styles);
  if (!text && !state.hasImage) return;
  if (extraType === "footnote" || extraType === "header" || extraType === "footer") {
    pushBlock(w, {
      type: extraType,
      text,
      source: { kind: "docx", paragraph: w.paraIndex, ...extraSource },
      ...(state.hasImage ? { metadata: { hasImage: true } } : {}),
    });
    return;
  }
  if (heading.yes) {
    pushBlock(w, {
      type: "heading",
      text,
      source: { kind: "docx", paragraph: w.paraIndex },
      metadata: { level: heading.level, ...(state.hasImage ? { hasImage: true } : {}) },
    });
    return;
  }
  if (numPr) {
    const numId = kid(numPr, "w:numId")?.attrs["w:val"] ?? "?";
    const ilvl = kid(numPr, "w:ilvl")?.attrs["w:val"] ?? "0";
    pushBlock(w, {
      type: "list",
      text,
      source: { kind: "docx", paragraph: w.paraIndex },
      metadata: { listId: `${numId}/${ilvl}`, listLevel: Number(ilvl) || 0, ...(state.hasImage ? { hasImage: true } : {}) },
    });
    return;
  }
  pushBlock(w, {
    type: "paragraph",
    text,
    source: { kind: "docx", paragraph: w.paraIndex },
    ...(state.hasImage ? { metadata: { hasImage: true } } : {}),
  });
}

function walkTable(w: Walker, tbl: XEl): void {
  w.tableIndex++;
  const tableIndex = w.tableIndex;
  const rows = kids(tbl, "w:tr").map((tr, r) => {
    let col = 0;
    return kids(tr, "w:tc").map((tc) => {
      col++;
      const tcPr = kid(tc, "w:tcPr");
      const gridSpan = Number(kid(tcPr, "w:gridSpan")?.attrs["w:val"] ?? 1) || 1;
      const vMerge = kid(tcPr, "w:vMerge")?.attrs["w:val"];
      const state = { hasImage: false };
      const text = cellText(tc, state).trim();
      const meta: { colSpan?: number; mergedFrom?: string } = {};
      if (gridSpan > 1) meta.colSpan = gridSpan;
      // vMerge="continue": клетка продолжает объединённый диапазон сверху.
      if (vMerge === "continue") meta.mergedFrom = "above";
      const cell = {
        text,
        row: r + 1,
        column: col,
        ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}),
      };
      col += gridSpan - 1;
      return cell;
    });
  });
  const table = {
    tableIndex,
    pageNumber: 1,
    rows,
    metadata: { rows: rows.length, cols: Math.max(0, ...rows.map((r) => r.length)) },
  };
  w.tables.push(table);
  pushBlock(w, {
    type: "table",
    text: rows.map((r) => r.map((c) => c.text).join(" | ")).join("\n"),
    source: { kind: "docx", paragraph: w.paraIndex + 1 },
    metadata: { tableIndex },
  });
}

function walkBody(w: Walker, container: XEl | undefined): void {
  if (!container) return;
  for (const child of elements(container)) {
    if (child.name === "w:p") walkParagraph(w, child);
    else if (child.name === "w:tbl") walkTable(w, child);
    else if (child.name === "w:sdt") walkBody(w, kid(child, "w:sdtContent"));
    // w:sectPr и прочее — не контент.
  }
}

export function extractDocx(bytes: Uint8Array): DocxExtractResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("DOCX не распаковывается: архив повреждён");
  }
  const readPart = (name: string): XEl | undefined => {
    const raw = files[name];
    if (!raw) return undefined;
    return parseXml(strFromU8(raw));
  };
  const document = readPart("word/document.xml");
  if (!document) throw new Error("DOCX без word/document.xml");
  const body = kid(document, "w:body");
  if (!body) throw new Error("DOCX без w:body");

  const w: Walker = {
    paraIndex: 0,
    tableIndex: 0,
    blockSeq: 0,
    truncated: false,
    blocks: [],
    tables: [],
    styles: readStyles(readPart("word/styles.xml")),
  };
  walkBody(w, body);
  // Колонтитулы и сноски — отдельными типами блоков (порядок: после тела).
  for (const name of Object.keys(files)) {
    if (/^word\/header\d*\.xml$/.test(name)) {
      const hdr = readPart(name);
      if (hdr && hdr.name === "w:hdr") for (const p of kids(hdr, "w:p")) walkParagraph(w, p, "header");
    }
  }
  for (const name of Object.keys(files)) {
    if (/^word\/footer\d*\.xml$/.test(name)) {
      const ftr = readPart(name);
      if (ftr && ftr.name === "w:ftr") for (const p of kids(ftr, "w:p")) walkParagraph(w, p, "footer");
    }
  }
  for (const part of ["word/footnotes.xml", "word/endnotes.xml"]) {
    const root = files[part] ? readPart(part) : undefined;
    if (!root) continue;
    for (const note of [...kids(root, "w:footnote"), ...kids(root, "w:endnote")]) {
      const id = note.attrs["w:id"];
      if (id === "-1" || id === "-2" || id === undefined) continue;
      for (const p of kids(note, "w:p")) {
        const before = w.blocks.length;
        walkParagraph(w, p, "footnote");
        const added = w.blocks[before];
        if (added && added.type === "footnote") {
          added.metadata = { ...added.metadata, noteId: id };
        }
      }
    }
  }
  const pages: EisPage[] = [{ pageNumber: 1, blocks: w.blocks }];
  return { pages, tables: w.tables, truncated: w.truncated };
}
