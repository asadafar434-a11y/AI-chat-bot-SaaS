import "server-only";
import { strToU8, zipSync } from "fflate";
import type { PartDoc } from "@/lib/part-doc";
import { modelOfPartDoc, modelOfTp, type Cell, type DocModel, type Para, type Row, type Run, type Table, type TpDocx } from "@/lib/tp-doc-model";
import type { TpPart } from "@/lib/tp-parts";

// Файл ODT (OpenDocument Text) — из того же описания документа (tp-doc-model.ts), что Word и PDF: тот же текст, те же таблицы,
// те же жёлтые места. ODT открывают LibreOffice, Р7-Офис, МойОфис и Word. Это архив из нескольких XML-файлов, отдельная
// библиотека не нужна. Устройство архива задаёт стандарт: mimetype — первым и без сжатия, иначе программа не узнает файл.

const MIME = "application/vnd.oasis.opendocument.text";
const FONT = "Times New Roman";
const YELLOW = "#ffff00";

// A4, поля как в Word: сверху и снизу 2 см, слева 3 см, справа 1,5 см — на текст остаётся 16,5 см.
const TEXT_WIDTH_CM = 16.5;

const NAMESPACES = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
].join(" ");

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';

const FONT_DECLS = `<office:font-face-decls><style:font-face style:name="${FONT}" svg:font-family="'${FONT}'" style:font-family-generic="roman" style:font-pitch="variable"/></office:font-face-decls>`;

// В XML нельзя управляющие знаки (кроме табуляции и перевода строки) и непарные половинки суррогатных пар: файл с ними не откроется.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Текст абзаца. В ODF пробелы сливаются: подряд идущие и стоящие с краю нужно писать тегом, как и табуляцию с переносом строки.
function textXml(text: string): string {
  const tokens = [...text.replace(INVALID_XML, "").matchAll(/\r\n|\n|\r|\t| +|[^\r\n\t ]+/g)].map((m) => m[0]);
  const isWord = (token: string | undefined) => token !== undefined && !/^(\r|\n|\t| )/.test(token);
  return tokens
    .map((token, i) => {
      if (token === "\t") return "<text:tab/>";
      if (token[0] === "\r" || token[0] === "\n") return "<text:line-break/>";
      if (token[0] === " ") {
        // Один пробел между двумя словами — обычный; в начале, в конце куска и несколько подряд — тегом.
        if (token.length === 1 && isWord(tokens[i - 1]) && isWord(tokens[i + 1])) return " ";
        return token.length === 1 ? "<text:s/>" : `<text:s text:c="${token.length}"/>`;
      }
      return escapeXml(token);
    })
    .join("");
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);
const pt = (n: number) => `${num(n)}pt`;
const letter = (i: number): string => (i >= 26 ? letter(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));

// Стили, которые нужны именно этому документу: у каждого сочетания свойств своё имя (P1, T1…), одинаковые не повторяются.
function styleRegistry(prefix: string, family: "paragraph" | "text", element: string, parent?: string) {
  const names = new Map<string, string>();
  const xml: string[] = [];
  return {
    xml,
    name(props: string): string {
      const known = names.get(props);
      if (known) return known;
      const name = `${prefix}${names.size + 1}`;
      names.set(props, name);
      xml.push(`<style:style style:name="${name}" style:family="${family}"${parent ? ` style:parent-style-name="${parent}"` : ""}><style:${element} ${props}/></style:style>`);
      return name;
    },
  };
}

// Ячейка таблицы: рамка 0,5 пункта и отступы внутри — как в Word и PDF.
const CELL_STYLE = '<style:style style:name="TC1" style:family="table-cell"><style:table-cell-properties fo:padding-top="3pt" fo:padding-bottom="3pt" fo:padding-left="5pt" fo:padding-right="5pt" fo:border="0.5pt solid #000000"/></style:style>';

export function renderOdt(model: DocModel): Buffer {
  const paragraphStyles = styleRegistry("P", "paragraph", "paragraph-properties", "Standard");
  const textStyles = styleRegistry("T", "text", "text-properties");
  const tableStyles: string[] = [];
  let tables = 0;

  const run = (r: Run): string => {
    const props = [
      r.bold ? 'fo:font-weight="bold"' : "",
      r.italics ? 'fo:font-style="italic"' : "",
      r.size ? `fo:font-size="${pt(r.size)}"` : "",
      r.highlight ? `fo:background-color="${YELLOW}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const text = textXml(r.text);
    return props ? `<text:span text:style-name="${textStyles.name(props)}">${text}</text:span>` : text;
  };

  const para = (p: Para): string => {
    const props = [
      p.align ? `fo:text-align="${p.align === "center" ? "center" : "justify"}"` : "",
      p.firstLine !== undefined ? `fo:text-indent="${pt(p.firstLine)}"` : "",
      p.left !== undefined ? `fo:margin-left="${pt(p.left)}"` : "",
      p.before !== undefined ? `fo:margin-top="${pt(p.before)}"` : "",
      p.after !== undefined ? `fo:margin-bottom="${pt(p.after)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const style = props ? paragraphStyles.name(props) : "Standard";
    const inner = p.runs.map(run).join("");
    return inner ? `<text:p text:style-name="${style}">${inner}</text:p>` : `<text:p text:style-name="${style}"/>`;
  };

  const cell = (c: Cell | undefined): string =>
    `<table:table-cell table:style-name="TC1" office:value-type="string">${c && c.paras.length ? c.paras.map(para).join("") : "<text:p/>"}</table:table-cell>`;

  const table = (t: Table): string => {
    if (t.rows.length === 0) return "";
    const n = ++tables;
    const columns = Math.max(1, ...t.rows.map((r) => r.cells.length));
    // Ширина столбцов — в долях первой строки; у столбца без доли — средняя. В сантиметрах, чтобы в сумме вышло 16,5.
    const first = t.rows[0].cells;
    const given = first.map((c) => c.width).filter((w) => w > 0);
    const average = given.length ? given.reduce((a, b) => a + b, 0) / given.length : 1;
    const weights = Array.from({ length: columns }, (_, c) => (first[c]?.width > 0 ? first[c].width : average));
    const total = weights.reduce((a, b) => a + b, 0);
    let used = 0;
    const widths = weights.map((w, c) => {
      const cm = c === columns - 1 ? Math.round((TEXT_WIDTH_CM - used) * 1000) / 1000 : Math.round(((TEXT_WIDTH_CM * w) / total) * 1000) / 1000;
      used += cm;
      return cm;
    });

    tableStyles.push(`<style:style style:name="Table${n}" style:family="table"><style:table-properties style:width="${TEXT_WIDTH_CM}cm" table:align="margins"/></style:style>`);
    widths.forEach((cm, c) =>
      tableStyles.push(
        `<style:style style:name="Table${n}.${letter(c)}" style:family="table-column"><style:table-column-properties style:column-width="${num(cm)}cm" style:rel-column-width="${Math.round((cm / TEXT_WIDTH_CM) * 65535)}*"/></style:style>`
      )
    );

    const rowXml = (row: Row) => `<table:table-row>${Array.from({ length: columns }, (_, c) => cell(row.cells[c])).join("")}</table:table-row>`;
    // Заголовок таблицы повторяется на каждой странице, как в Word.
    let headers = 0;
    while (headers < t.rows.length && t.rows[headers].header) headers++;
    return (
      `<table:table table:name="Table${n}" table:style-name="Table${n}">` +
      widths.map((_, c) => `<table:table-column table:style-name="Table${n}.${letter(c)}"/>`).join("") +
      (headers ? `<table:table-header-rows>${t.rows.slice(0, headers).map(rowXml).join("")}</table:table-header-rows>` : "") +
      t.rows.slice(headers).map(rowXml).join("") +
      "</table:table>"
    );
  };

  const body = model.blocks.map((b) => (b.type === "table" ? table(b) : para(b))).join("");

  const content =
    `${XML_HEAD}<office:document-content ${NAMESPACES} office:version="1.2">${FONT_DECLS}` +
    `<office:automatic-styles>${[...paragraphStyles.xml, ...textStyles.xml, ...tableStyles, CELL_STYLE].join("")}</office:automatic-styles>` +
    `<office:body><office:text>${body}</office:text></office:body></office:document-content>`;

  const styles =
    `${XML_HEAD}<office:document-styles ${NAMESPACES} office:version="1.2">${FONT_DECLS}` +
    "<office:styles>" +
    `<style:default-style style:family="paragraph"><style:text-properties style:font-name="${FONT}" fo:font-size="12pt" fo:language="ru" fo:country="RU"/></style:default-style>` +
    '<style:style style:name="Standard" style:family="paragraph" style:class="text"/>' +
    "</office:styles>" +
    '<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" style:print-orientation="portrait" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="3cm" fo:margin-right="1.5cm"/></style:page-layout></office:automatic-styles>' +
    '<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>' +
    "</office:document-styles>";

  const meta =
    `${XML_HEAD}<office:document-meta ${NAMESPACES} office:version="1.2"><office:meta>` +
    `<meta:generator>Тендерный юрист</meta:generator><dc:title>${escapeXml(model.title.replace(INVALID_XML, ""))}</dc:title>` +
    "</office:meta></office:document-meta>";

  const manifest =
    `${XML_HEAD}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">` +
    `<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${MIME}"/>` +
    ["content.xml", "styles.xml", "meta.xml"].map((file) => `<manifest:file-entry manifest:full-path="${file}" manifest:media-type="text/xml"/>`).join("") +
    "</manifest:manifest>";

  return Buffer.from(
    zipSync({
      // Первым и без сжатия — так программа узнаёт ODT по первым байтам архива.
      mimetype: [strToU8(MIME), { level: 0 }],
      "META-INF/manifest.xml": strToU8(manifest),
      "content.xml": strToU8(content),
      "styles.xml": strToU8(styles),
      "meta.xml": strToU8(meta),
    })
  );
}

export const buildTpOdt = (part: TpPart, data: TpDocx): Buffer => renderOdt(modelOfTp(part, data));

// Анкета, декларация или цена, которые ИИ написал по форме заказчика и образцам участника.
export const buildPartOdt = (doc: PartDoc): Buffer => renderOdt(modelOfPartDoc(doc));
