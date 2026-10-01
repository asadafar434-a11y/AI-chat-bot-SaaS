// Клавиатура в окне поверх страницы: Tab ходит по кругу внутри окна и не уходит под затемнение — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { tabTarget } from "./focus-trap.ts";

const dialog = "окно";
const [close, link, send] = ["закрыть", "ссылка", "отправить"];
const items = [close, link, send];
const inside = (active: string | null, back: boolean, list = items) => tabTarget(list, active, back, dialog, true);
const outside = (active: string | null, back: boolean, list = items) => tabTarget(list, active, back, dialog, false);

test("Tab в середине окна — браузер сам переходит дальше, мы не вмешиваемся", () => {
  assert.equal(inside(close, false), "stay");
  assert.equal(inside(link, false), "stay");
  assert.equal(inside(send, true), "stay");
  assert.equal(inside(link, true), "stay");
});

test("Tab с последнего элемента уходит на первый, Shift+Tab с первого — на последний: по кругу", () => {
  assert.equal(inside(send, false), close);
  assert.equal(inside(close, true), send);
});

test("сразу после открытия фокус на самом окне: Tab ведёт к первому элементу, Shift+Tab — к последнему", () => {
  assert.equal(inside(dialog, false), "stay");
  assert.equal(inside(dialog, true), send);
});

test("фокус на прокручиваемой области внутри окна (в списке её нет): Tab и Shift+Tab решает браузер, цикл не рвётся", () => {
  // Раньше такой фокус считался «вне окна» и каждый Tab возвращал к крестику: до кнопок внизу окна было не добраться.
  assert.equal(inside("область прокрутки", false), "stay");
  assert.equal(inside("область прокрутки", true), "stay");
});

test("фокус оказался вне окна (на странице под затемнением или нигде) — возвращается внутрь", () => {
  assert.equal(outside("кнопка на странице", false), close);
  assert.equal(outside("кнопка на странице", true), send);
  assert.equal(outside(null, false), close);
  assert.equal(outside(null, true), send);
});

test("в окне один элемент: Tab и Shift+Tab держат фокус на нём", () => {
  assert.equal(inside(close, false, [close]), close);
  assert.equal(inside(close, true, [close]), close);
});

test("в окне нечего выбирать — фокус остаётся на окне (null: Tab глотается, страница под ним недоступна)", () => {
  assert.equal(inside(dialog, false, []), null);
  assert.equal(outside(null, true, []), null);
});
