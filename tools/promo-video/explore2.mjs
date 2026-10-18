import { launch, openSample, clickText, bodyText, sleep } from "./lib.mjs";

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on("requestfailed", (r) => console.log("FAILED", r.url().slice(0, 100)));
await openSample(page);
await clickText(page, "Посмотреть на примере");
await sleep(2500);
const id = await page.evaluate(() => location.hash.match(/#\/p\/([^/]+)/)?.[1]);
await page.evaluate((id) => (location.hash = `#/p/${id}/review`), id);
await sleep(1500);
console.log("compose:", await clickText(page, "Составить документы"));
await sleep(5000);
console.log((await bodyText(page)).slice(300, 1800).replace(/\n+/g, " | "));
const buttons = await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => b.textContent.trim().slice(0, 50)).filter(Boolean).slice(0, 30));
console.log("КНОПКИ:", buttons.join(" ¦ "));
await browser.close();
