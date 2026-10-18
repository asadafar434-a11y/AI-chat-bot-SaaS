import fs from "node:fs";
import path from "node:path";
import { launch, openSample, clickText, sleep } from "./lib.mjs";
const OUT = path.resolve(import.meta.dirname, "shots");
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await openSample(page);
await page.evaluate(() => document.querySelector('[aria-label="Тёмная тема"]')?.click());
await sleep(400);
await clickText(page, "Посмотреть на примере");
await sleep(2500);
const id = await page.evaluate(() => location.hash.match(/#\/p\/([^/]+)/)?.[1]);
await page.evaluate((id) => (location.hash = `#/p/${id}/price`), id);
await sleep(2000);
for (let v = 0; v <= 34; v++) {
  await page.evaluate((v) => {
    const el = document.querySelector("input[type=range]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);
  await sleep(180);
  const card = await page.evaluate(() => {
    const r = document.querySelector("input[type=range]").closest("[class*=rounded-xl]").getBoundingClientRect();
    return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });
  await page.screenshot({ path: path.join(OUT, `price-${String(v).padStart(2, "0")}.png`), type: "png", clip: card });
}
await browser.close();
console.log("ползунок: 35 состояний");
