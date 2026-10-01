// Разбор XML-частей файла Word (.docx) без библиотек: дерево из элементов с атрибутами и текстом.
// Нужен ровно для документа, стилей, нумерации и сносок Word — это хорошо сформированный XML без внешних сущностей.
// Приставки пространств имён приводятся к обычным («w:», «mc:»), даже если файл составила программа с другими:
// так чтение Word не зависит от того, как назвали приставку.

export type XEl = { name: string; attrs: Record<string, string>; kids: (XEl | string)[] };

const W_NAMESPACES = ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"];
const MC_NAMESPACE = "http://schemas.openxmlformats.org/markup-compatibility/2006";

// Глубже — не документ, а попытка уронить разбор.
const MAX_DEPTH = 300;
export const MAX_XML_CHARS = 80_000_000;

const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g;
const decode = (s: string) =>
  s.includes("&")
    ? s.replace(ENTITY, (whole, code: string) => {
        if (code[0] !== "#") return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[code] ?? whole;
        const n = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      })
    : s;

const ATTR = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

export function parseXml(xml: string): XEl {
  if (xml.length > MAX_XML_CHARS) throw new Error("XML слишком большой");
  const stack: XEl[] = [];
  let root: XEl | undefined;
  let alias: Map<string, string> | null = null;

  const rename = (name: string) => {
    if (!alias) return name;
    const colon = name.indexOf(":");
    const canonical = colon > 0 ? alias.get(name.slice(0, colon)) : undefined;
    return canonical ? `${canonical}${name.slice(colon)}` : name;
  };

  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i && stack.length) stack[stack.length - 1].kids.push(decode(xml.slice(i, lt)));

    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end < 0) throw new Error("XML оборван");
      i = end + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end < 0) throw new Error("XML оборван");
      if (stack.length) stack[stack.length - 1].kids.push(xml.slice(lt + 9, end));
      i = end + 3;
    } else if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end < 0) throw new Error("XML оборван");
      i = end + 2;
    } else if (xml.startsWith("<!", lt)) {
      // Объявление типа документа: сущности из него не подставляются, поэтому просто пропускаем.
      const end = xml.indexOf(">", lt + 2);
      if (end < 0) throw new Error("XML оборван");
      i = end + 1;
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt + 2);
      if (end < 0) throw new Error("XML оборван");
      const open = stack.pop();
      if (!open || open.name !== rename(xml.slice(lt + 2, end).trim())) throw new Error("XML сломан: теги не сходятся");
      i = end + 1;
    } else {
      let j = lt + 1;
      while (j < n && !/[\s/>]/.test(xml[j])) j++;
      const rawName = xml.slice(lt + 1, j);
      if (!rawName) throw new Error("XML сломан: тег без имени");
      const raw: [string, string][] = [];
      for (;;) {
        ATTR.lastIndex = j;
        const m = ATTR.exec(xml);
        if (!m) break;
        raw.push([m[1], decode(m[2] ?? m[3])]);
        j = ATTR.lastIndex;
      }
      while (j < n && /\s/.test(xml[j])) j++;
      const selfClosing = xml[j] === "/";
      if (selfClosing) j++;
      if (xml[j] !== ">") throw new Error("XML сломан: тег не закрыт");
      i = j + 1;

      // Приставки узнаём по корневому элементу: после него все имена приводятся к «w:» и «mc:».
      if (!root) {
        const found = new Map<string, string>();
        for (const [k, v] of raw) {
          if (!k.startsWith("xmlns:")) continue;
          if (W_NAMESPACES.includes(v)) found.set(k.slice(6), "w");
          else if (v === MC_NAMESPACE) found.set(k.slice(6), "mc");
        }
        const needed = [...found].some(([prefix, canonical]) => prefix !== canonical);
        alias = needed ? found : null;
      }
      const el: XEl = { name: rename(rawName), attrs: {}, kids: [] };
      for (const [k, v] of raw) el.attrs[rename(k)] = v;
      if (stack.length) stack[stack.length - 1].kids.push(el);
      else if (!root) root = el;
      else throw new Error("XML сломан: несколько корней");
      if (!selfClosing) {
        if (stack.length >= MAX_DEPTH) throw new Error("XML слишком вложенный");
        stack.push(el);
      }
    }
  }
  if (!root || stack.length) throw new Error("XML оборван");
  return root;
}

export const kids = (el: XEl | undefined, name: string): XEl[] =>
  el ? el.kids.filter((k): k is XEl => typeof k !== "string" && k.name === name) : [];

export const kid = (el: XEl | undefined, name: string): XEl | undefined =>
  el?.kids.find((k): k is XEl => typeof k !== "string" && k.name === name);

export const elements = (el: XEl): XEl[] => el.kids.filter((k): k is XEl => typeof k !== "string");

// Значение w:val у вложенного элемента: <w:numId w:val="3"/> → "3".
export const val = (el: XEl | undefined, child: string): string | undefined => kid(el, child)?.attrs["w:val"];

export const textOf = (el: XEl): string => el.kids.map((k) => (typeof k === "string" ? k : "")).join("");
