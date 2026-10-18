// Общие помощники: запуск установленного Chrome без загрузки браузера, вход в экран продукта без аккаунта.
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error("Не найден Chrome или Edge");

export const launch = (args = []) =>
  puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--hide-scrollbars", "--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none", "--autoplay-policy=no-user-gesture-required", ...args],
  });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Экран продукта на dev-сервере (закупки в браузере, без входа): принять согласия и открыть пример.
export async function openSample(page, base = "http://localhost:5199/") {
  await page.goto(base, { waitUntil: "networkidle2" });
  await sleep(600);
  const consent = await page.$("input[type=checkbox]");
  if (consent) {
    await page.$$eval("input[type=checkbox]", (cs) => cs.forEach((c) => c.click()));
    await sleep(200);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Продолжить"))?.click());
    await sleep(1200);
  }
}

export const clickText = (page, text, tag = "button") =>
  page.evaluate(
    (text, tag) => {
      const el = [...document.querySelectorAll(tag)].find((b) => b.textContent.trim().includes(text));
      if (!el) return false;
      el.click();
      return true;
    },
    text,
    tag,
  );

export const bodyText = (page) => page.evaluate(() => document.body.innerText);
