import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import test from "node:test";

import { createHttpMedicineReference } from "./http.ts";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function withServer(
  handler: Handler,
  run: (baseUrl: string, requests: string[]) => Promise<void>,
): Promise<void> {
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url} ${request.headers.authorization ?? ""}`);
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("тестовый сервер не запустился");
  try {
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const snapshot = {
  source: "test-reference",
  edition: "2026-01",
  effectiveFrom: "2026-01-01",
  complete: true,
};

test("reference http: item и snapshot, Bearer-токен", async () => {
  await withServer(
    (_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          snapshot,
          item: { registrationNumber: "ЛП-000001", zhvnlp: true, maxPrice: 950, vatRate: 10 },
        }),
      );
    },
    async (baseUrl, requests) => {
      const port = createHttpMedicineReference({ baseUrl, token: "secret" });
      const result = await port.lookup("ЛП-000001");
      assert.equal(result.snapshot.source, "test-reference");
      assert.equal(result.item?.zhvnlp, true);
      assert.equal(result.item?.maxPrice, 950);
      assert.match(requests[0] ?? "", /Bearer secret/);
      assert.match(requests[0] ?? "", /registrationNumber=/);
    },
  );
});

test("reference http: null item допустим, битый snapshot отклоняется", async () => {
  let mode: "null" | "invalid" = "null";
  await withServer(
    (_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          snapshot: mode === "null" ? snapshot : { source: "test-reference" },
          item: null,
        }),
      );
    },
    async (baseUrl) => {
      const port = createHttpMedicineReference({ baseUrl });
      assert.equal((await port.lookup("ЛП-000001")).item, null);

      mode = "invalid";
      await assert.rejects(() => port.lookup("ЛП-000001"), /edition/);
    },
  );
});

test("reference http: таймаут запроса", async () => {
  await withServer(
    () => {
      // Намеренно не отвечаем.
    },
    async (baseUrl) => {
      const port = createHttpMedicineReference({ baseUrl, timeoutMs: 20 });
      await assert.rejects(() => port.lookup("ЛП-000001"), /таймаут/);
    },
  );
});
