// Контраст текста в светлой и тёмной теме экрана — npm test. Читает цвета из design-system/prototype/src/index.css:
// если новая версия из Figma Make вернёт бледные цвета, тест скажет, какая пара не проходит (норма WCAG AA — 4,5 : 1).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../design-system/prototype/src/index.css");
const css = readFileSync(CSS, "utf8");

type Rgb = [number, number, number];

function tokens(selector: string): Record<string, Rgb> {
  const block = css.match(new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1];
  assert.ok(block, `в index.css нет блока ${selector}`);
  const out: Record<string, Rgb> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*#([0-9a-f]{6})\b/gi)) {
    out[m[1]] = [0, 2, 4].map((i) => parseInt(m[2].slice(i, i + 2), 16)) as Rgb;
  }
  return out;
}

const linear = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const ratio = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
// Плашка «цвет на 10 %» поверх фона — так рисуются бейджи и подсказки (bg-success/10 и подобные).
const tint = (color: Rgb, over: Rgb): Rgb => color.map((v, i) => v * 0.1 + over[i] * 0.9) as Rgb;

for (const [theme, selector] of [["светлая", ":root"], ["тёмная", ".dark"]] as const) {
  const t = tokens(selector);

  test(`${theme} тема: основной и подписной текст читаются на холсте, карточках и серых плашках`, () => {
    for (const text of ["foreground", "muted-foreground"]) {
      for (const bg of ["background", "card", "secondary"]) {
        const r = ratio(t[text], t[bg]);
        assert.ok(r >= 4.5, `${text} на ${bg}: ${r.toFixed(2)} (нужно 4,5)`);
      }
    }
  });

  test(`${theme} тема: «готово», «ошибка», «пояснение» и «дописать» читаются и на фоне, и на своих плашках`, () => {
    for (const color of ["success", "danger", "info"]) {
      for (const bg of ["background", "card"]) {
        assert.ok(ratio(t[color], t[bg]) >= 4.5, `${color} на ${bg}: ${ratio(t[color], t[bg]).toFixed(2)}`);
        const plate = tint(t[color], t[bg]);
        assert.ok(ratio(t[color], plate) >= 4.5, `${color} на плашке поверх ${bg}: ${ratio(t[color], plate).toFixed(2)}`);
      }
    }
    assert.ok(ratio(t["warn-foreground"], t["warn-surface"]) >= 4.5, "«дописать»: текст на жёлтой плашке");
  });

  test(`${theme} тема: текст на главной кнопке и на кнопке «опасно» читается`, () => {
    assert.ok(ratio(t["primary-foreground"], t["primary"]) >= 4.5, "главная кнопка");
    // Кнопка «опасно» (variant danger в ui.tsx) — свой цвет текста на цвете ошибки.
    assert.ok(ratio(t["danger-foreground"], t["danger"]) >= 4.5, "кнопка danger");
  });
}

test("кнопка «опасно» в ui.tsx не возвращается к белому тексту: в тёмной теме он не читался", () => {
  const ui = readFileSync(path.resolve(path.dirname(CSS), "components/ui.tsx"), "utf8");
  assert.match(ui, /danger: 'bg-danger text-danger-foreground/);
});

// Фирменный голубой «Тендекса» (логотип, 29.10.2026): главные кнопки и выбранные значки — #2F5BFF с белым текстом в обеих темах; ни одна не возвращается к чёрному.
for (const [theme, selector] of [["светлая", ":root"], ["тёмная", ".dark"]] as const) {
  test(`${theme} тема: главная кнопка — фирменный голубой #2F5BFF с белым текстом, фокус читается на холсте и карточках`, () => {
    const t = tokens(selector);
    assert.deepEqual(t["primary"], [0x2f, 0x5b, 0xff], "цвет главной кнопки");
    assert.deepEqual(t["primary-foreground"], [255, 255, 255], "текст на главной кнопке");
    assert.ok(ratio(t["primary-foreground"], t["primary"]) >= 4.5, "белый на голубом");
    for (const bg of ["background", "card"]) assert.ok(ratio(t["ring"], t[bg]) >= 3, `рамка фокуса на ${bg}: ${ratio(t["ring"], t[bg]).toFixed(2)} (нужно 3 для элементов интерфейса)`);
  });
}

test("выбранные значки и переключатели — голубые, а не чёрные: нигде нет «border-foreground bg-foreground / bg-primary»", () => {
  const src = path.resolve(path.dirname(CSS));
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /.tsx$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const bad = walk(src).filter((f) => /border-foreground bg-(?:foreground|primary)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad.map((f) => path.relative(src, f)), []);
});
