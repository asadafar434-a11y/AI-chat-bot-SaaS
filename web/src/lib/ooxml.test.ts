// Разбор XML частей файла Word — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { elements, kid, kids, MAX_XML_CHARS, parseXml, textOf, val } from "./ooxml.ts";

test("элементы, атрибуты, текст; объявление, комментарии и CDATA", () => {
  const root = parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!-- комментарий -->
<w:a xmlns:w="urn:x" id='1' title="a &amp; b"><w:b w:val="3"/><w:t>один &lt;два&gt; &#1103; &#x44F;</w:t><w:t><![CDATA[<сырой> & текст]]></w:t></w:a>`
  );
  assert.equal(root.name, "w:a");
  assert.deepEqual(root.attrs, { "xmlns:w": "urn:x", id: "1", title: "a & b" });
  assert.equal(val(root, "w:b"), "3");
  const [one, two] = kids(root, "w:t");
  assert.equal(textOf(one), "один <два> я я");
  assert.equal(textOf(two), "<сырой> & текст");
  assert.equal(elements(root).length, 3);
  assert.equal(kid(root, "w:нет"), undefined);
  assert.deepEqual(kids(undefined, "w:t"), []);
});

test("пробелы внутри текста остаются как есть", () => {
  const root = parseXml('<r><t xml:space="preserve">  с пробелами  </t></r>');
  assert.equal(textOf(kid(root, "t")!), "  с пробелами  ");
});

test("приставки приводятся к «w:» и «mc:», даже если файл составила программа с другими", () => {
  const root = parseXml(
    `<ns0:document xmlns:ns0="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
      `<ns0:body><ns0:p ns0:rsid="1"><m:AlternateContent/></ns0:p></ns0:body></ns0:document>`
  );
  assert.equal(root.name, "w:document");
  const p = kid(kid(root, "w:body"), "w:p");
  assert.ok(p);
  assert.equal(p.attrs["w:rsid"], "1");
  assert.ok(kid(p, "mc:AlternateContent"));
});

test("строгий вариант Word (другое пространство имён) читается так же", () => {
  const root = parseXml(`<x:document xmlns:x="http://purl.oclc.org/ooxml/wordprocessingml/main"><x:body/></x:document>`);
  assert.equal(root.name, "w:document");
  assert.ok(kid(root, "w:body"));
});

test("сломанный XML — ошибка, а не тихий пропуск", () => {
  for (const bad of ["", "текст без тегов", "<a><b></a>", "<a>", "<a b=1/>", "<a><!-- обрыв", "<a/><b/>", "<a><![CDATA[обрыв</a>", "<>"]) {
    assert.throws(() => parseXml(bad), Error, JSON.stringify(bad));
  }
});

test("объявление типа документа пропускается, подставлять сущности из него не из чего", () => {
  const root = parseXml('<!DOCTYPE a [<!ENTITY x "подмена">]><a>&x;</a>');
  assert.equal(textOf(root), "&x;");
});

test("слишком вложенный и слишком большой XML отклоняются", () => {
  assert.throws(() => parseXml("<a>".repeat(400)), /слишком вложенный/);
  assert.throws(() => parseXml(`<a>${"x".repeat(MAX_XML_CHARS)}</a>`), /слишком большой/);
});

test("большой документ разбирается быстро", () => {
  const xml = `<w:body>${'<w:p><w:r><w:t>Исполнитель обязан обеспечить площадку.</w:t></w:r></w:p>'.repeat(60000)}</w:body>`;
  const started = performance.now();
  const root = parseXml(xml);
  assert.equal(kids(root, "w:p").length, 60000);
  assert.ok(performance.now() - started < 3000, `${Math.round(performance.now() - started)} мс`);
});
