// Снимает настоящие экраны продукта (пример закупки, тёмная тема) в высоком разрешении для ролика.
// Нужен dev-сервер экрана: PRODUCT_STORAGE=browser npx vite --port 5199 (в design-system/prototype).
import fs from "node:fs";
import path from "node:path";
import { launch, openSample, clickText, sleep } from "./lib.mjs";

const OUT = path.resolve(import.meta.dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });

const W = 1440;
const H = 900;
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
await openSample(page);

// Тёмная тема — кнопкой в шапке меню.
const isDark = () => page.evaluate(() => document.documentElement.getAttribute("data-theme") === "dark" || document.documentElement.classList.contains("dark"));
if (!(await isDark())) {
  await page.evaluate(() => document.querySelector('[aria-label="Тёмная тема"]')?.click());
  await sleep(500);
}
console.log("тёмная тема:", await isDark());

await clickText(page, "Посмотреть на примере");
await sleep(2500);
const id = await page.evaluate(() => location.hash.match(/#\/p\/([^/]+)/)?.[1]);
const go = async (step, wait = 1800) => {
  await page.evaluate((id, step) => (location.hash = `#/p/${id}/${step}`), id, step);
  await sleep(wait);
  await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
  await sleep(300);
};
const shot = (name, clip) => page.screenshot({ path: path.join(OUT, name), type: "png", ...(clip ? { clip } : {}) });

// Высокая страница: основная колонка целиком, чтобы в ролике её можно было «пролистать».
const tall = async (name) => {
  await page.setViewport({ width: W, height: 3000, deviceScaleFactor: 2 });
  await sleep(700);
  const box = await page.evaluate(() => {
    const m = document.querySelector("main > div");
    const r = m.getBoundingClientRect();
    return { x: Math.floor(r.x), y: 0, width: Math.ceil(r.width), height: Math.ceil(Math.min(r.height + 40, 2900)) };
  });
  await shot(name, box);
  console.log(name, box);
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
  await sleep(500);
};

await go("upload");
await shot("upload.png");

await go("analysis");
await shot("analysis.png");
await tall("analysis-tall.png");

// Цена: ползунок в нескольких положениях (в ролике перелистываем).
await go("price");
await shot("price.png");
const range = await page.$("input[type=range]");
const pos = Array.from({ length: 35 }, (_, i) => i);
for (const v of pos) {
  await page.evaluate((v) => {
    const el = document.querySelector("input[type=range]");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);
  await sleep(250);
  const card = await page.evaluate(() => {
    const el = document.querySelector("input[type=range]").closest("[class*=rounded-xl]");
    const r = el.getBoundingClientRect();
    return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });
  await shot(`price-${String(v).padStart(2, "0")}.png`, card);
}
console.log("ползунок снят");
await go("price");

// Проверка: составить документы — на примере это без ИИ.
await go("review");
await clickText(page, "Составить документы");
await sleep(5000);
await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
await sleep(500);
await shot("review.png");
await tall("review-tall.png");

await go("package", 2500);
await shot("package.png");
await tall("package-tall.png");

await browser.close();
console.log("готово:", fs.readdirSync(OUT).join(", "));
