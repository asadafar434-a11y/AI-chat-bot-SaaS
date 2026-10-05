// EIS Collector v1: integration-тест на mock HTTP-сервере (без live ЕИС).
// Проверяет цепочку целиком: SOAP discovery -> архив -> RAW -> manifest -> normalized,
// а также CLI `eis:collect --dry-run` через дочерний процесс. Запуск: npm test.
//
// ВАЖНО: mock для CLI-теста поднимается в ОТДЕЛЬНОМ процессе (startExternalMockEis).
// Дочерний процесс, порождённый из-под `node --test`, на некоторых машинах не может
// установить соединение к серверу внутри тестового процесса (коннекты виснут),
// а к соседнему процессу ходит нормально — проверено диагностикой.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EisHttpClient } from "../client.ts";
import { Eis44Adapter } from "../discovery.ts";
import { runCollector } from "../collector.ts";
import { makeZip, soapArchiveResponse, soapDiscoveryResponse } from "./helpers.ts";

const REG = "0373100130926000001";
const WEB_DIR = fileURLToPath(new URL("../../../..", import.meta.url));

interface MockEis {
  server: Server;
  port: number;
  requests: string[];
}

async function startMockEis(): Promise<MockEis> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Uint8Array) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "POST" && url === "/soap") {
        requests.push(body.slice(0, 200));
        const port = (server.address() as { port: number }).port;
        const payload = body.includes("getDocsByReestrNumberRequest")
          ? soapArchiveResponse(`http://127.0.0.1:${port}/archive.zip`)
          : soapDiscoveryResponse([REG]);
        res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
        res.end(payload);
        return;
      }
      if (req.method === "GET" && url === "/archive.zip") {
        const zip = makeZip([{ name: "notice.xml", data: new TextEncoder().encode("<notice id='1'/>"), method: 0 }]);
        res.writeHead(200, { "content-type": "application/zip" });
        res.end(Buffer.from(zip));
        return;
      }
      res.writeHead(404);
      res.end("nope");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  const port = (server.address() as { port: number }).port;
  return { server, port, requests };
}

function stopMockEis(mock: MockEis): void {
  // closeAllConnections: idle keep-alive от fetch не должен держать event loop.
  mock.server.closeAllConnections();
  mock.server.close();
}

test("integration: полный цикл через mock СОИ (real adapter + real HTTP)", async () => {
  const mock = await startMockEis();
  const root = mkdtempSync(join(tmpdir(), "eis-http-"));
  try {
    const config = {
      baseUrl: `http://127.0.0.1:${mock.port}/soap`,
      authToken: "mock-token",
      dryRun: false,
      maxTenders: 10,
      requestDelayMs: 0,
      maxRetries: 1,
      timeoutMs: 5000,
      storagePath: root,
    };
    const adapter = new Eis44Adapter(new EisHttpClient(config), config.authToken);
    const stats = await runCollector({
      config,
      filters: { law: "44fz", dateFrom: "2026-09-01", dateTo: "2026-09-01" },
      adapter,
      logger: () => {},
      now: new Date("2026-09-02T00:00:00Z"),
    });
    assert.equal(stats.found, 1);
    assert.equal(stats.succeeded, 1);
    assert.equal(stats.documentsDownloaded, 1);
    const dir = join(root, "raw", "44fz", "2026", "09", REG);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as {
      documents: Array<{ fileName: string; sha256: string; localPath: string }>;
    };
    assert.equal(manifest.documents[0]?.fileName, "notice.xml");
    // RAW без изменений.
    const raw = readFileSync(join(root, manifest.documents[0]!.localPath), "utf-8");
    assert.equal(raw, "<notice id='1'/>");
    assert.ok(existsSync(join(root, "normalized", "44fz", "2026", "09", REG, "tender.json")));
    assert.ok(mock.requests.length >= 2);
  } finally {
    stopMockEis(mock);
  }
});

test("integration: CLI dry-run не пишет файлы и печатает план", async () => {
  const mock = await startExternalMockEis();
  const root = mkdtempSync(join(tmpdir(), "eis-cli-"));
  try {
    const spawned = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "--import",
        "./scripts/test-alias.mjs",
        "scripts/eis-collect.ts",
        "--law=44fz",
        "--date-from=2026-09-01",
        "--date-to=2026-09-01",
        "--max-tenders=10",
        `--base-url=http://127.0.0.1:${mock.port}/soap`,
        `--storage=${root}`,
        "--dry-run",
      ],
      {
        cwd: WEB_DIR,
        env: {
          ...process.env,
          EIS_AUTH_TOKEN: "cli-mock-token",
          EIS_TIMEOUT_MS: "10000",
          EIS_MAX_RETRIES: "1",
          EIS_REQUEST_DELAY_MS: "50",
        },
        encoding: "utf-8",
        timeout: 90000,
      },
    );
    const out = `${spawned.stdout ?? ""}\n${spawned.stderr ?? ""}`;
    assert.equal(spawned.status, 0, `CLI exit code: ${spawned.status}\n${out}`);
    assert.ok(out.includes("DRY-RUN"), out);
    assert.ok(out.includes(REG), out);
    assert.ok(out.includes("Найдено закупок: 1"), out);
    assert.ok(out.includes("Ожидается документов (по метаданным): 1"), out);
    assert.ok(!existsSync(join(root, "raw")), "dry-run не должен создавать raw/");
    assert.ok(!out.includes("cli-mock-token"), "токен не должен попадать в вывод CLI");
  } finally {
    mock.close();
  }
});

/**
 * Mock СОИ в отдельном процессе: фикстура пишется во временный каталог,
 * процесс сообщает порт строкой MOCK_PORT=N в stdout.
 */
async function startExternalMockEis(): Promise<{ port: number; close: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "eis-mock-"));
  const fixturePath = join(dir, "mock-soi.cjs");
  const source = `
const http = require("node:http");
const REG = ${JSON.stringify(REG)};
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c.toString(); });
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/soap") {
      const port = server.address().port;
      const payload = body.includes("getDocsByReestrNumberRequest")
        ? Resp.archive("http://127.0.0.1:" + port + "/archive.xml")
        : Resp.discovery();
      res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
      res.end(payload);
      return;
    }
    if (req.method === "GET" && req.url === "/archive.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end("<notice id='1'><reestrNumber>" + REG + "</reestrNumber></notice>");
      return;
    }
    res.writeHead(404);
    res.end("nope");
  });
});
const Resp = {
  discovery: () =>
    "<?xml version='1.0'?><soap:Envelope xmlns:soap='http://schemas.xmlsoap.org/soap/envelope/'>" +
    "<soap:Body><r><reestrNumber>" + REG + "</reestrNumber></r></soap:Body></soap:Envelope>",
  archive: (url) =>
    "<?xml version='1.0'?><soap:Envelope xmlns:soap='http://schemas.xmlsoap.org/soap/envelope/'>" +
    "<soap:Body><r><dataInfo><archiveUrl>" + url + "</archiveUrl></dataInfo></r></soap:Body></soap:Envelope>",
};
server.listen(0, "127.0.0.1", () => console.log("MOCK_PORT=" + server.address().port));
`;
  writeFileSync(fixturePath, source, "utf-8");
  const child: ChildProcess = spawn(process.execPath, [fixturePath], { stdio: ["ignore", "pipe", "pipe"] });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mock СОИ не сообщил порт за 10s")), 10000);
    child.stdout?.on("data", (chunk: Uint8Array) => {
      const m = String(chunk).match(/MOCK_PORT=(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  return { port, close: () => void child.kill() };
}
