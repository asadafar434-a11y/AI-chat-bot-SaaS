const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "design-system", "mockup");
const port = 4173;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  if (reqPath === "/") reqPath = "/app-screens.html";
  const filePath = path.join(root, reqPath);
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    // Страницы для Artifact пишутся без каркаса — оборачиваем так же, как при публикации.
    if (ext === ".html" && !/^\s*<!doctype/i.test(data.toString("utf8", 0, 64))) {
      res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${data}</body></html>`);
      return;
    }
    res.end(data);
  });
}).listen(port, () => console.log(`static server on http://localhost:${port}`));
