// Скачивание одного доп. бланка: в файле только он, без заявки — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { modelOfTp, type TpDocx } from "./tp-doc-model.ts";

const SOURCE = "Извещение, приложение № 2 к информационной карте";
const TITLE = "Декларация участника закупки о принадлежности к субъектам малого предпринимательства";
const blank = { source: SOURCE, title: TITLE, pages: "стр. 25–27", fields: [{ label: "Наименование участника", value: "" }] };

function data(extra: Partial<TpDocx> = {}): TpDocx {
  return {
    subject: "",
    form: { title: "Заявка на участие в запросе котировок", source: SOURCE, participantFields: [], consent: "", hasPrice: false, priceNote: "", smeDeclaration: "", goodsTableHeaders: [] },
    goods: [],
    items: [],
    detectedForms: [blank],
    cast: null,
    price: null,
    profile: null,
    ...extra,
  };
}

test("скачивание одного бланка: в файле только он, без заявки", () => {
  const model = modelOfTp("application", data({ blankOnly: true }));
  const text = JSON.stringify(model.blocks);
  assert.equal(model.title, TITLE);
  assert.ok(text.includes("Наименование участника"));
  assert.ok(text.includes("стр. 25–27"));
  assert.ok(!text.includes("ЗАЯВКА"));
});

test("заявка без признака бланка собирается как прежде", () => {
  const text = JSON.stringify(modelOfTp("application", data()).blocks);
  assert.ok(text.includes("ЗАЯВКА"));
});
