// Что вписано на месте жёлтых полей: ответ тот же, что у прежнего разбора регулярным выражением, но без зависания — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { filledValues } from "./fields.ts";

// Прежний разбор — образец для сравнения: на коротких текстах он быстрый и отвечает правильно.
function byRegExp(template: string, text: string): (string | null)[] {
  const bits = template.split(/(\[[^\]]+\])/);
  const holes = bits.filter((_, i) => i % 2).length;
  if (!holes) return [];
  const escaped = bits.map((b, i) => (i % 2 ? "([\\s\\S]*?)" : b.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&")));
  const m = new RegExp(`^${escaped.join("")}$`).exec(text);
  return m ? m.slice(1) : Array.from({ length: holes }, () => null);
}

// Одинаковые случайные числа при каждом запуске: упавший случай можно повторить.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("на коротких текстах ответ тот же, что у прежнего разбора: совпавшие, переписанные и случайные тексты", () => {
  const next = random(20261001);
  const pick = <T,>(items: T[]) => items[Math.floor(next() * items.length)];
  const pieces = ["", "a", "b", " ", ", ", "ab", "x y", "\n", ".", "аб"];
  const values = ["", "1", "ab", "a b", ", ", "x", "a, b", "\n"];
  for (let n = 0; n < 3000; n++) {
    const holes = Math.floor(next() * 5);
    let template = pick(pieces);
    let text = template;
    for (let h = 0; h < holes; h++) {
      const literal = pick(pieces);
      template += `[поле ${h}]${literal}`;
      text += `${pick(values)}${literal}`;
    }
    // Часть текстов портим: убрали, вставили или подменили знак — заготовка уже не находится или находится иначе.
    if (next() < 0.5 && text.length) {
      const at = Math.floor(next() * text.length);
      const edit = Math.floor(next() * 3);
      text = edit === 0 ? text.slice(0, at) + text.slice(at + 1) : edit === 1 ? text.slice(0, at) + pick(pieces) + text.slice(at) : text.slice(0, at) + pick(pieces) + text.slice(at + 1);
    }
    assert.deepEqual(filledValues(template, text), byRegExp(template, text), `заготовка ${JSON.stringify(template)}, текст ${JSON.stringify(text)}`);
  }
});

test("переписанный длинный текст не подвешивает страницу: сколько бы ни было полей", () => {
  const text = Array.from({ length: 400 }, (_, i) => `слово${i}`).join(", ") + " конец";
  for (const holes of [4, 6, 8, 20, 60]) {
    const template = Array.from({ length: holes }, (_, i) => `[поле ${i}]`).join(", ") + " конец!";
    const started = performance.now();
    const found = filledValues(template, text);
    const spent = performance.now() - started;
    assert.equal(found.length, holes);
    assert.ok(found.every((v) => v === null), "текст не совпал — значений нет");
    assert.ok(spent < 200, `полей ${holes}: ${Math.round(spent)} мс`);
  }
});

test("длинный текст, где всё вписано: значения находятся на своих местах и быстро", () => {
  const holes = 12;
  const template = Array.from({ length: holes }, (_, i) => `Параметр ${i}: [значение ${i}].`).join("\n");
  const text = Array.from({ length: holes }, (_, i) => `Параметр ${i}: ${"значение ".repeat(300)}${i}.`).join("\n");
  const started = performance.now();
  const found = filledValues(template, text);
  assert.ok(performance.now() - started < 200);
  assert.deepEqual(found, Array.from({ length: holes }, (_, i) => `${"значение ".repeat(300)}${i}`));
});
