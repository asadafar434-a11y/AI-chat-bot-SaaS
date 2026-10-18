import { launch, openSample, clickText, sleep } from "./lib.mjs";
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await openSample(page);
await page.evaluate(() => document.querySelector('[aria-label="Тёмная тема"]')?.click());
await clickText(page, "Посмотреть на примере");
await sleep(2500);
const id = await page.evaluate(() => location.hash.match(/#\/p\/([^/]+)/)?.[1]);
await page.evaluate((id) => (location.hash = `#/p/${id}/price`), id);
await sleep(1800);
console.log(JSON.stringify(await page.evaluate(() => {
  const r = document.querySelector("input[type=range]").closest("[class*=rounded-xl]").getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
})));
await browser.close();
