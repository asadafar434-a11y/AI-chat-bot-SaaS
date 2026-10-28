// Проверка адаптивности и единообразия экранов: временный профиль Chrome, эмуляция телефона (360), планшета (768) и компьютера (1280), встроенный пример закупки.
// Запуск: интерфейс без входа — PRODUCT_STORAGE=browser npm --prefix design-system/prototype run dev -- --port 3005 (и сервер: npm --prefix web run dev -- --port 3001), затем
//   node design-system/prototype/scripts/responsive-audit.mjs <папка для результатов>   (адрес — переменной AUDIT_URL; нужен Google Chrome)
// Результат: results.json (переполнение по ширине, мелкие зоны нажатия, обрезка текста, виден ли текущий шаг) и снимки в shots/. Хранилище одноразовое: данные владельца не затрагиваются.
// Проверка адаптивности: временный профиль Chrome, эмуляция экранов, замеры по каждому экрану приложения. Данные владельца не трогаются: хранилище одноразовое, закупка — встроенный пример.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const OUT = process.argv[2];
const BASE = process.env.AUDIT_URL ?? "http://localhost:3005/";
const PORT = 9333;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = `${OUT}/profile`;
rmSync(profile, { recursive: true, force: true });
mkdirSync(`${OUT}/shots`, { recursive: true });
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(path, method = "GET") {
  for (let i = 0; i < 40; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}${path}`, { method })).json();
    } catch {
      await sleep(250);
    }
  }
  throw new Error("chrome не запустился");
}
const tab = await json("/json/new?about:blank", "PUT");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
};
const cdp = (method, params = {}) => new Promise((res) => {
  const n = ++id;
  pending.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expr) => {
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description?.slice(0, 200) };
  return r.result?.result?.value;
};
const device = (w, h, mobile) => cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
await cdp("Page.enable");
await cdp("Runtime.enable");
await device(1280, 900, false);
await cdp("Page.navigate", { url: BASE });
await sleep(3500);
// тестовое хранилище: согласия записываем в одноразовый профиль, как их записывает экран согласий
await evaluate(`localStorage.setItem('tl_consent', JSON.stringify({ edition: '27 сентября 2026 г.', processing: true, transfer: true, at: new Date().toISOString() })); 1`);
await cdp("Page.navigate", { url: BASE });
await sleep(3500);
const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Посмотреть на примере')); if (b) b.click(); return !!b; })()`);
await sleep(3000);
const pid = (await evaluate(`location.hash.match(/#\\/p\\/([^/]+)/)?.[1] ?? null`));
if (!pid) {
  console.log(JSON.stringify({ fatal: "пример не открылся", clicked, hash: await evaluate("location.hash"), text: (await evaluate("document.body.innerText.slice(0,200)")) }));
  chrome.kill();
  process.exit(1);
}
// составляем документы в примере (готовая заготовка, ИИ не вызывается)
await evaluate(`location.hash = '#/p/${pid}/review'; 1`);
await sleep(2000);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Составить документы'); if (b) b.click(); return !!b; })()`);
await sleep(4500);

const MEASURE = `(() => {
  const vw = innerWidth, de = document.documentElement;
  const vis = (e) => { const rc = e.getBoundingClientRect(), cs = getComputedStyle(e); return rc.width > 0 && rc.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const inScroll = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && p.scrollWidth > p.clientWidth) return true; } return false; };
  const off = [];
  document.querySelectorAll('body *').forEach((e) => {
    if (!vis(e)) return;
    const cs = getComputedStyle(e);
    if (cs.position === 'fixed') return;
    const rc = e.getBoundingClientRect();
    if (rc.right > vw + 1 && !inScroll(e) && off.length < 5) off.push(e.tagName.toLowerCase() + ' «' + (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 34) + '» ' + Math.round(rc.right) + '>' + vw);
  });
  const targets = [...document.querySelectorAll('button, a, input:not([type=hidden]), select, summary, [role=button]')].filter(vis).filter((e) => !e.closest('[aria-hidden=true]') && !e.classList.contains('sr-only'));
  const small = targets.filter((e) => { const rc = e.getBoundingClientRect(); return rc.height < 28 || (rc.width < 28 && !(e.innerText || '').trim()); }).map((e) => Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height) + ' «' + (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 26) + '»');
  const clipped = [...document.querySelectorAll('body *')].filter((e) => { if (!vis(e)) return false; const cs = getComputedStyle(e); return cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1; }).length;
  const clippedSample = [...document.querySelectorAll('body *')].filter((e) => { if (!vis(e)) return false; const cs = getComputedStyle(e); return cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1; }).slice(0, 6).map((e) => (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40));
  const act = document.querySelector('[data-step-active="true"]'); const ar = act ? act.getBoundingClientRect() : null; const stepVisible = ar ? (ar.left >= 0 && ar.right <= vw) : null;
  const h1 = document.querySelector('h1');
  return { sw: de.scrollWidth, vw, overflowX: de.scrollWidth > vw + 1, off, small: small.length, smallSample: small.slice(0, 5), clipped, clippedSample, stepVisible, h1: h1 ? getComputedStyle(h1).fontSize : null, h: de.scrollHeight };
})()`;

const routes = {
  home: "#/", analytics: "#/analytics", search: "#/search", history: "#/history", tariffs: "#/tariffs", settings: "#/settings",
  upload: `#/p/${pid}/upload`, analysis: `#/p/${pid}/analysis`, price: `#/p/${pid}/price`, review: `#/p/${pid}/review`, package: `#/p/${pid}/package`,
};
const widths = [
  [360, 780, true],
  [768, 1024, true],
  [1280, 900, false],
];
const results = [];
for (const [w, h, mobile] of widths) {
  await device(w, h, mobile);
  await sleep(500);
  for (const [name, hash] of Object.entries(routes)) {
    await evaluate(`location.hash = ${JSON.stringify(hash)}; 1`);
    await sleep(1800);
    const m = await evaluate(MEASURE);
    results.push({ name, w, ...m });
    if ([360, 768, 1280].includes(w)) {
      const shot = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 55, captureBeyondViewport: false });
      if (shot.result?.data) writeFileSync(`${OUT}/shots/${name}-${w}.jpg`, Buffer.from(shot.result.data, "base64"));
    }
  }
}
// Низкое окно: блоки меню не должны сжиматься (кнопка «Новая закупка» — 36 пикселей, а не 20).
await device(1280, 520, false);
await evaluate(`location.hash = '#/'; 1`);
await sleep(1500);
const shortH = await evaluate(`(() => { const b = [...document.querySelectorAll('aside button')].find((x) => x.textContent.includes('Новая закупка')); return b ? Math.round(b.getBoundingClientRect().height) : null; })()`);
results.push({ name: 'low-window-1280x520', newPurchaseButtonHeight: shortH, ok: shortH === 36 });
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify({ ok: true, n: results.length }));
ws.close();
chrome.kill();
