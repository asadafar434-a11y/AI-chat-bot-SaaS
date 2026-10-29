// Логотип «Тендекс» (29.10.2026): значки сайта, знак в меню и цвет главной кнопки берутся из одного комплекта design-system/logo/ — npm test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const at = (...p: string[]) => path.join(ROOT, ...p);
const read = (...p: string[]) => readFileSync(at(...p));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const pngSize = (b: Buffer) => {
  assert.equal(b.subarray(1, 4).toString("latin1"), "PNG", "это не PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

test("комплект логотипа на месте: знак, значок, логотип (светлый и тёмный фон) и PNG", () => {
  for (const f of ["tendex-znak.svg", "tendex-ikonka.svg", "tendex-logo.svg", "tendex-logo-dlya-temnogo-fona.svg", "png/tendex-ikonka-1024.png", "png/tendex-ikonka-512.png", "png/tendex-ikonka-180.png", "png/tendex-favikon-32.png", "png/tendex-favikon-64.png", "png/tendex-logo-1600.png"]) {
    assert.ok(existsSync(at("design-system/logo", f)), `нет design-system/logo/${f}`);
  }
});

test("значки сайта и знак в меню — из комплекта: размеры, одинаковые файлы в прототипе и в приложении", () => {
  assert.equal(sha(read("design-system/logo.png")), sha(read("design-system/logo/png/tendex-ikonka-1024.png")));
  assert.deepEqual(pngSize(read("web/src/app/icon.png")), [512, 512]);
  assert.deepEqual(pngSize(read("web/src/app/apple-icon.png")), [180, 180]);
  assert.deepEqual(pngSize(read("design-system/prototype/public/favicon.png")), [64, 64]);
  assert.equal(sha(read("design-system/prototype/public/favicon.png")), sha(read("design-system/logo/png/tendex-favikon-64.png")));
  const mark = read("web/src/assets/logo-128.png");
  assert.deepEqual(pngSize(mark), [128, 128]);
  assert.equal(sha(mark), sha(read("design-system/prototype/src/assets/logo-128.png")), "знак в приложении и в прототипе один");
  const ico = read("web/src/app/favicon.ico");
  assert.equal(ico.readUInt16LE(2), 1, "favicon.ico — значок");
  assert.equal(ico.readUInt16LE(4), 2, "в favicon.ico два размера: 32 и 64");
});

test("цвет главной кнопки — цвет логотипа: #2F5BFF во всех фирменных токенах", () => {
  const svg = read("design-system/logo/tendex-znak.svg").toString("utf8");
  assert.match(svg, /#2F5BFF/i);
  for (const f of ["design-system/prototype/src/index.css", "design-system/brand.css"]) {
    assert.match(readFileSync(at(f), "utf8"), /--primary:\s*#2f5bff;/i, `${f}: главная кнопка не голубая`);
  }
  assert.match(readFileSync(at("web/src/app/globals.css"), "utf8"), /--brand:\s*#2f5bff;/i);
});
