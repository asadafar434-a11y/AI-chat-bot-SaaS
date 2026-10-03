// EIS Document Intelligence: XML-извлечение (пути/текст/атрибуты/namespace). Запуск: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractXml } from "../extract/xml.ts";

const EIS_LIKE = `<?xml version="1.0" encoding="UTF-8"?>
<export xmlns="urn:eis:common" xmlns:fcs="urn:eis:fcs">
  <fcs:notification number="0373100130926000001" status="active">
    <fcs:customer inn="7701234567">Ромашка</fcs:customer>
    <fcs:price currency="RUB">1500000</fcs:price>
  </fcs:notification>
</export>`;

test("xml: структура, xpath, атрибуты, namespace", () => {
  const result = extractXml(EIS_LIKE);
  const byPath = new Map(result.elements.map((e) => [e.xpath, e]));
  const customer = byPath.get("/export[1]/fcs:notification[1]/fcs:customer[1]");
  assert.ok(customer);
  assert.equal(customer.text, "Ромашка");
  assert.equal(customer.namespace, "urn:eis:fcs");
  assert.deepEqual(customer.attributes, { inn: "7701234567" });
  const notif = byPath.get("/export[1]/fcs:notification[1]");
  assert.ok(notif);
  assert.deepEqual(notif.attributes, { number: "0373100130926000001", status: "active" });
  assert.equal(notif.namespace, "urn:eis:fcs");
  // Блоки ссылаются на xpath.
  const block = result.pages[0]?.blocks.find((b) => b.text === "Ромашка");
  assert.ok(block);
  assert.equal(block.source.kind, "xml");
  assert.equal(block.source.xpath, "/export[1]/fcs:notification[1]/fcs:customer[1]");
  assert.equal(block.metadata?.tag, "fcs:customer");
  assert.equal(result.truncated, false);
});

test("xml: индексы одноимённых соседей", () => {
  const result = extractXml("<root><item>A</item><item>B</item></root>");
  const paths = result.elements.map((e) => e.xpath);
  assert.ok(paths.includes("/root[1]/item[1]"));
  assert.ok(paths.includes("/root[1]/item[2]"));
});

test("xml: сломанный XML бросает понятную ошибку", () => {
  assert.throws(() => extractXml("<root><unclosed>"), /XML/);
});
