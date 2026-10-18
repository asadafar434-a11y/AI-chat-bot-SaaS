// Снимает кадры ролика и склеивает их в mp4 (ffmpeg).
//   node render.mjs --frames=3,7.5,12      — только указанные секунды, PNG в out/frames (для просмотра)
//   node render.mjs --sheet=0,5,10         — то же, но одной контактной картой out/sheet.png
//   node render.mjs                        — весь ролик в out/Тендерный-юрист-презентация.mp4
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { launch } from "./lib.mjs";

const ROOT = import.meta.dirname;
const OUT = path.join(ROOT, "out");
fs.mkdirSync(path.join(OUT, "frames"), { recursive: true });
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const FFMPEG = process.env.FFMPEG || "ffmpeg";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(4777, r));

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text()); });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("http://localhost:4777/video.html", { waitUntil: "load" });
await page.evaluate(() => window.ready);
const draw = (t) => page.evaluate(async (t) => { window.renderFrame(t); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }, t);

const list = arg("frames") ?? arg("sheet");
if (list) {
  const times = list.split(",").map(Number);
  for (const t of times) {
    await draw(t);
    await page.screenshot({ path: path.join(OUT, "frames", `t${String(t).padStart(5, "0")}.png`), type: "png" });
  }
  console.log("кадры:", times.join(", "));
} else {
  const { FPS, TOTAL } = await page.evaluate(() => window.VIDEO);
  const file = path.join(OUT, arg("name") ?? "Тендерный-юрист-презентация.mp4");
  const ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-vcodec", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((r) => ff.on("close", r));
  const n = Math.round(TOTAL * FPS);
  const from = Number(arg("from") ?? 0), to = Number(arg("to") ?? n);
  const started = Date.now();
  for (let i = from; i < to; i++) {
    await draw(i / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 94 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 90 === 0) console.log(`кадр ${i}/${n} · ${((Date.now() - started) / 1000).toFixed(0)} с`);
  }
  ff.stdin.end();
  await done;
  console.log("готово:", file);
}
await browser.close();
server.close();
