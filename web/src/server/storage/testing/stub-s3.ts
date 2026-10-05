/**
 * Minimal in-process S3-совместимый stub для протокольных тестов (только тесты).
 *
 * Проверяет ПОДЛИННОСТЬ каждого подписанного запроса пересчётом SigV4 своим
 * секретом: клиент с чужим секретом и подменённые запросы получают 403.
 * Неподписанные прямые запросы к объектам — тоже 403 (бакет приватный).
 * Presigned-ссылки проверяются через `verifyPresignedUrl`. Хеш тела
 * сверяется независимым пересчётом (а не доверием заголовку).
 *
 * Поддерживает ровно то, что использует `S3StorageAdapter`:
 * PUT/GET(presigned)/DELETE/HEAD объекта и `?list-type=2`.
 */

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { authorizationHeader, parseAmzDate, verifyPresignedUrl } from "../sign.ts";

export type StubObject = { bytes: Buffer; contentType: string; sha256: string | null };

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

export type StubS3 = {
  url: string;
  objects: Map<string, StubObject>;
  close(): Promise<void>;
};

export async function startStubS3(options: {
  bucket: string;
  region: string;
  secretAccessKey: string;
}): Promise<StubS3> {
  const objects = new Map<string, StubObject>();

  /** Пересчёт подписи своим секретом. Хеш тела — независимым пересчётом. */
  function checkHeaderAuth(
    request: IncomingMessage,
    full: URL,
    key: string,
    body: Buffer,
  ): boolean {
    const authorization = request.headers.authorization ?? "";
    const match = authorization.match(
      /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]+)$/,
    );
    if (!match) {
      return false;
    }
    const [, credential, signed, signature] = match;
    const scope = credential.split("/");
    if (scope.length !== 5) {
      return false;
    }
    const [, dateStamp, region] = scope;
    if (region !== options.region) {
      return false;
    }
    const rawDate = request.headers["x-amz-date"];
    const issued = parseAmzDate(Array.isArray(rawDate) ? rawDate[0] : rawDate);
    if (!issued || Math.abs(Date.now() - issued.getTime()) > 15 * 60 * 1000) {
      return false;
    }
    void dateStamp;
    const query: Record<string, string> = {};
    for (const [k, v] of full.searchParams) {
      query[k] = v;
    }
    const headers: Record<string, string> = {};
    for (const name of signed.split(";")) {
      if (name === "host") {
        continue;
      }
      const value = request.headers[name];
      if (typeof value !== "string") {
        return false;
      }
      headers[name] = value;
    }
    // Независимая проверка: хеш тела пересчитываем сами, а не верим заголовку.
    const actualHash = createHash("sha256").update(body).digest("hex");
    if (headers["x-amz-content-sha256"] && headers["x-amz-content-sha256"] !== actualHash) {
      return false;
    }
    const rawHost = request.headers.host;
    const host = Array.isArray(rawHost) ? rawHost[0] : (rawHost ?? "");
    const expected = authorizationHeader({
      method: (request.method ?? "GET").toUpperCase(),
      endpoint: `http://${host}`,
      bucket: options.bucket,
      key,
      query,
      headers,
      payloadHashHex: actualHash,
      region: options.region,
      accessKeyId: scope[0],
      secretAccessKey: options.secretAccessKey,
      now: issued,
      pathStyle: true,
    });
    return expected.authorization.split("Signature=")[1] === signature;
  }

  const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const fail = (status: number, message: string) => {
      response.writeHead(status, { "Content-Type": "text/plain" });
      response.end(message);
    };
    const body = await readBody(request).catch(() => null);
    if (!body) {
      fail(400, "BadRequest");
      return;
    }
    const full = new URL(request.url ?? "/", "http://stub");
    const parts = full.pathname.split("/").slice(1);
    // Корень бакета может прийти с замыкающим слэшем: пустой хвост отбрасывается.
    while (parts.length > 1 && parts[parts.length - 1] === "") {
      parts.pop();
    }
    const method = (request.method ?? "GET").toUpperCase();

    // Листинг бакета: GET /bucket/?list-type=2&prefix=… (только с подписью).
    if (parts.length === 1 && method === "GET" && full.searchParams.get("list-type") === "2") {
      if (parts[0] !== options.bucket) {
        fail(404, "NoSuchBucket");
        return;
      }
      if (!checkHeaderAuth(request, full, "", body)) {
        fail(403, "SignatureDoesNotMatch");
        return;
      }
      const prefix = full.searchParams.get("prefix") ?? "";
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const xml =
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>` +
        keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("") +
        `</ListBucketResult>`;
      response.writeHead(200, { "Content-Type": "application/xml" });
      response.end(xml);
      return;
    }

    if (parts.length < 2 || parts[0] !== options.bucket) {
      fail(404, "NoSuchKey");
      return;
    }
    const key = parts.slice(1).join("/");

    // Скачивание по presigned-ссылке: подпись в query, заголовков не нужно.
    // Хост восстанавливается из заголовка: подпись покрывает именно его.
    if (method === "GET" && full.searchParams.has("X-Amz-Signature")) {
      const rawHost = request.headers.host;
      const hostHeader = Array.isArray(rawHost) ? rawHost[0] : (rawHost ?? "stub");
      const checked = verifyPresignedUrl(`http://${hostHeader}${request.url}`, {
        secretAccessKey: options.secretAccessKey,
        region: options.region,
        bucket: options.bucket,
        pathStyle: true,
      });
      if (!checked.ok || checked.key !== key) {
        fail(403, "SignatureDoesNotMatch");
        return;
      }
      const object = objects.get(key);
      if (!object) {
        fail(404, "NoSuchKey");
        return;
      }
      response.writeHead(200, {
        "Content-Type": object.contentType,
        "Content-Disposition": "attachment",
      });
      response.end(object.bytes);
      return;
    }

    // Прямой доступ без подписи запрещён: бакет приватный.
    if (!checkHeaderAuth(request, full, key, body)) {
      fail(403, "SignatureDoesNotMatch");
      return;
    }

    if (method === "PUT") {
      objects.set(key, {
        bytes: body,
        contentType: (request.headers["content-type"] as string) ?? "application/octet-stream",
        sha256: (request.headers["x-amz-meta-sha256"] as string) ?? null,
      });
      response.writeHead(200, {});
      response.end();
      return;
    }
    if (method === "DELETE") {
      if (!objects.delete(key)) {
        fail(404, "NoSuchKey");
        return;
      }
      response.writeHead(204, {});
      response.end();
      return;
    }
    if (method === "HEAD") {
      const object = objects.get(key);
      if (!object) {
        fail(404, "NoSuchKey");
        return;
      }
      response.writeHead(200, {
        "Content-Length": String(object.bytes.length),
        ...(object.sha256 ? { "x-amz-meta-sha256": object.sha256 } : {}),
      });
      response.end();
      return;
    }
    fail(405, "MethodNotAllowed");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    objects,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
