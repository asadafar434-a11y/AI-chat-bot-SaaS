import { launch, openSample, clickText, bodyText, sleep } from "./lib.mjs";

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await openSample(page);
console.log("--- список:", (await bodyText(page)).slice(0, 300).replace(/\n+/g, " | "));
console.log("sample click:", await clickText(page, "Посмотреть на примере"));
await sleep(2500);
console.log("hash:", await page.evaluate(() => location.hash));
for (const step of ["upload", "analysis", "price", "review", "package"]) {
  const id = await page.evaluate(() => location.hash.match(/#\/p\/([^/]+)/)?.[1]);
  await page.evaluate((id, step) => (location.hash = `#/p/${id}/${step}`), id, step);
  await sleep(1800);
  const text = await bodyText(page);
  const buttons = await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => b.textContent.trim().slice(0, 60)).filter(Boolean).slice(0, 25));
  console.log(`\n=== ${step} ===\n`, text.slice(0, 700).replace(/\n+/g, " | "), "\nКНОПКИ:", buttons.join(" ¦ "));
}
await browser.close();
