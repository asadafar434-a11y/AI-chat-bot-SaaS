// Файлы .docx для тестов, собранные из XML на месте: настоящих документов в репозитории для проверок не нужно.
// Только для тестов чтения Word (docx-reader.test.ts, extract-text.test.ts).
import { strToU8, zipSync } from "fflate";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const NS =
  `xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ` +
  `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml"`;
export const HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export type Parts = { body: string; styles?: string; numbering?: string; footnotes?: string };

export function docx({ body, styles, numbering, footnotes }: Parts): Uint8Array {
  const extra = [
    styles && ["styles", "word/styles.xml", styles, "styles"],
    numbering && ["numbering", "word/numbering.xml", numbering, "numbering"],
    footnotes && ["footnotes", "word/footnotes.xml", footnotes, "footnotes"],
  ].filter((x): x is string[] => Array.isArray(x));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        extra.map(([, path, , kind]) => `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`).join("") +
        `</Types>`
    ),
    "_rels/.rels": strToU8(`${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`),
    "word/_rels/document.xml.rels": strToU8(
      `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        extra.map(([type, path]) => `<Relationship Id="rId-${type}" Type="${REL}/${type}" Target="${path.replace("word/", "")}"/>`).join("") +
        `</Relationships>`
    ),
    "word/document.xml": strToU8(`${HEAD}<w:document ${NS}><w:body>${body}</w:body></w:document>`),
  };
  for (const [, path, xml] of extra) files[path] = strToU8(xml);
  return zipSync(files);
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const run = (s: string, bold = false) => `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(s)}</w:t></w:r>`;
export const para = (content: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${content}</w:p>`;
export const p = (s: string, pPr = "", bold = false) => para(run(s, bold), pPr);
export const num = (id: number, lvl = 0) => `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${id}"/></w:numPr>`;
export const cell = (content: string, tcPr = "") => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ""}${content || "<w:p/>"}</w:tc>`;
export const c = (s: string, tcPr = "") => cell(s ? p(s) : "", tcPr);
export const tr = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
export const tbl = (...rows: string[]) => `<w:tbl><w:tblPr/>${rows.join("")}</w:tbl>`;
export const lvl = (i: number, fmt: string, text: string, extra = "") => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/>${extra}<w:lvlText w:val="${text}"/></w:lvl>`;
export const abstract = (id: number, ...levels: string[]) => `<w:abstractNum w:abstractNumId="${id}">${levels.join("")}</w:abstractNum>`;
export const numInstance = (id: number, abstractId: number, extra = "") => `<w:num w:numId="${id}"><w:abstractNumId w:val="${abstractId}"/>${extra}</w:num>`;
export const numbering = (...parts: string[]) => `${HEAD}<w:numbering ${NS}>${parts.join("")}</w:numbering>`;
export const styles = (...parts: string[]) => `${HEAD}<w:styles ${NS}>${parts.join("")}</w:styles>`;
export const style = (id: string, name: string, extra = "", basedOn = "") =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${basedOn ? `<w:basedOn w:val="${basedOn}"/>` : ""}<w:pPr>${extra}</w:pPr></w:style>`;
