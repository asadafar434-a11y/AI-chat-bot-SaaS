/**
 * EIS Document Intelligence — извлечение из XML (извещения/протоколы ЕИС и др.).
 *
 * Структура НЕ уничтожается: каждый элемент с текстом — запись {xpath, tag,
 * namespace, text, attributes} + блок с source.xpath. Полный исходник хранится
 * в xmlSource нормализованного документа. Парсер — @/lib/ooxml (переиспользуется).
 */

import { elements, parseXml, type XEl } from "../../../lib/ooxml.ts";
import type { EisBlock, EisPage, EisXmlElement } from "./types.ts";

export interface XmlExtractResult {
  pages: EisPage[];
  elements: EisXmlElement[];
  truncated: boolean;
}

const MAX_ELEMENTS = 20000;
const MAX_BLOCKS_PER_DOC = 20000;

type NsScope = Map<string, string>;

function childScope(parent: NsScope, el: XEl): NsScope {
  let scope: NsScope | undefined;
  for (const [name, value] of Object.entries(el.attrs)) {
    if (name === "xmlns" || name.startsWith("xmlns:")) {
      if (!scope) scope = new Map(parent);
      scope.set(name === "xmlns" ? "" : name.slice(6), value);
    }
  }
  return scope ?? parent;
}

function namespaceOf(scope: NsScope, tag: string): string | undefined {
  const colon = tag.indexOf(":");
  const prefix = colon > 0 ? tag.slice(0, colon) : "";
  return scope.get(prefix);
}

export function extractXml(source: string): XmlExtractResult {
  const root = parseXml(source);
  const elementsOut: EisXmlElement[] = [];
  const blocks: EisBlock[] = [];
  let truncated = false;
  let seq = 0;
  // Счётчики позиций среди одноимённых соседей — для детерминированных xpath.
  const walk = (el: XEl, path: string, scope: NsScope): void => {
    if (elementsOut.length >= MAX_ELEMENTS) {
      truncated = true;
      return;
    }
    const local = childScope(scope, el);
    const text = el.kids.filter((k): k is string => typeof k === "string").join("").trim();
    const attributes: Record<string, string> = {};
    for (const [name, value] of Object.entries(el.attrs)) {
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      attributes[name] = value;
    }
    const tag = el.name;
    const namespace = namespaceOf(local, tag);
    const kids = elements(el);
    // Запись — у элементов с собственным текстом либо у листьев (пустые листья пропускаем).
    if (text || kids.length === 0) {
      if (text) {
        elementsOut.push({
          xpath: path,
          tag,
          ...(namespace ? { namespace } : {}),
          text,
          attributes,
        });
        if (seq < MAX_BLOCKS_PER_DOC) {
          seq++;
          blocks.push({
            id: `b${seq}`,
            type: "paragraph",
            text,
            source: { kind: "xml", xpath: path },
            metadata: {
              tag,
              ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
            },
          });
        } else {
          truncated = true;
        }
      }
    } else {
      // Контейнер без собственного текста: фиксируем структуру без блока.
      elementsOut.push({ xpath: path, tag, ...(namespace ? { namespace } : {}), text: "", attributes });
    }
    const counters = new Map<string, number>();
    for (const child of kids) {
      const n = (counters.get(child.name) ?? 0) + 1;
      counters.set(child.name, n);
      walk(child, `${path}/${child.name}[${n}]`, local);
      if (truncated && elementsOut.length >= MAX_ELEMENTS) return;
    }
  };
  walk(root, `/${root.name}[1]`, new Map());
  const pages: EisPage[] = [{ pageNumber: 1, blocks }];
  return { pages, elements: elementsOut, truncated };
}
