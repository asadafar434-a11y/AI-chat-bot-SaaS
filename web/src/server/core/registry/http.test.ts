import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import test from "node:test";

import { createHttpRegistry } from "./http.ts";

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

const device = {
  registrationNumber: "ФСЗ 2026/00001",
  status: "active",
  model: "Test Model",
  manufacturer: "Тестовый завод",
  source: "test-registry",
  checkedAt: "2026-10-27",
};

const medicine = {
  registrationNumber: "ЛП-000001",
  status: "active",
  name: "Тестовый препарат",
  form: "таблетки",
  dosage: "10 мг",
  manufacturer: "Тестовый завод",
  source: "test-registry",
  checkedAt: "2026-10-27",
};

test("registry http: устройства и лекарства, Bearer-токен", async () => {
  await withServer(
    (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url?.startsWith("/devices/lookup")) {
        response.end(JSON.stringify(device));
        return;
      }
      response.end(JSON.stringify(medicine));
    },
    async (baseUrl, requests) => {
      const ports = createHttpRegistry({ baseUrl, token: "secret" });
      const deviceRecord = await ports.devices.lookup({ registrationNumber: "ФСЗ 2026/00001" });
      assert.equal(deviceRecord.model, "Test Model");
      const medicineRecord = await ports.medicines.lookup({ registrationNumber: "ЛП-000001" });
      assert.equal(medicineRecord.name, "Тестовый препарат");

      assert.equal(requests.length, 2);
      assert.ok(requests.every((request) => request.includes("Bearer secret")));
      assert.match(requests[0] ?? "", /registrationNumber=%D0%A4%D0%A1%D0%97/);
    },
  );
});

test("registry http: 404 даёт not_found, битый ответ отклоняется", async () => {
  let mode: "404" | "invalid" = "404";
  await withServer(
    (_request, response) => {
      if (mode === "404") {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ status: "active" }));
    },
    async (baseUrl) => {
      const ports = createHttpRegistry({ baseUrl });
      const missing = await ports.devices.lookup({ registrationNumber: "нет" });
      assert.equal(missing.status, "not_found");
      assert.equal(missing.registrationNumber, "нет");

      mode = "invalid";
      await assert.rejects(
        () => ports.devices.lookup({ registrationNumber: "ФСЗ 2026/00001" }),
        /registrationNumber/,
      );
    },
  );
});

test("registry http: таймаут запроса", async () => {
  await withServer(
    () => {
      // Намеренно не отвечаем.
    },
    async (baseUrl) => {
      const ports = createHttpRegistry({ baseUrl, timeoutMs: 20 });
      await assert.rejects(
        () => ports.devices.lookup({ registrationNumber: "ФСЗ 2026/00001" }),
        /таймаут/,
      );
    },
  );
});
