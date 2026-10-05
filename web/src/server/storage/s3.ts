/**
 * S3-совместимый клиент поверх `fetch`: SigV4 без SDK.
 *
 * - PUT/DELETE/HEAD/LIST — заголовок `Authorization` (`authorizationHeader`);
 * - GET для клиента — presigned URL (`presignGetUrl`), долгоживущих или
 *   публичных ссылок нет;
 * - sha256 содержимого кладётся в `x-amz-meta-sha256` (подписанный заголовок),
 *   поэтому `headObject` возвращает контрольную сумму без скачивания;
 * - список объектов — только для reconciliation (`prefix`), постранично.
 *
 * Работает с любым S3-совместимым endpoint (AWS, MinIO, Yandex, Selectel):
 * специфики провайдера нет, только стандартный REST + SigV4.
 */

import { authorizationHeader, encodeRfc3986, presignGetUrl, sha256HexBytes } from "./sign.ts";
import { StorageError, type StorageAdapter, type StoredObjectHead } from "./types.ts";

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle: boolean;
};

function objectUrl(config: S3Config, key: string): string {
  const base = config.endpoint.replace(/\/+$/, "");
  const encoded = key.split("/").map((s) => encodeRfc3986(s)).join("/");
  return config.pathStyle
    ? `${base}/${encodeRfc3986(config.bucket)}/${encoded}`
    : `${base.replace("://", `://${config.bucket}.`)}/${encoded}`;
}

export class S3StorageAdapter implements StorageAdapter {
  readonly backend = "s3";
  private readonly config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
  }

  private signed(
    method: string,
    key: string,
    headers: Record<string, string>,
    payloadHashHex: string,
    query: Record<string, string> = {},
    now?: Date,
  ): { url: string; auth: { authorization: string; amzDate: string } } {
    const auth = authorizationHeader({
      method,
      endpoint: this.config.endpoint,
      bucket: this.config.bucket,
      key,
      query,
      headers,
      payloadHashHex,
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      now,
      pathStyle: this.config.pathStyle,
    });
    return { url: objectUrl(this.config, key), auth };
  }

  async putObject(key: string, bytes: Uint8Array, options: { contentType?: string; sha256?: string } = {}): Promise<void> {
    const payloadHash = sha256HexBytes(bytes);
    const headers: Record<string, string> = {
      "content-type": options.contentType ?? "application/octet-stream",
      "x-amz-content-sha256": payloadHash,
    };
    if (options.sha256) {
      headers["x-amz-meta-sha256"] = options.sha256;
    }
    const { url, auth } = this.signed("PUT", key, headers, payloadHash);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "PUT",
        headers: {
          ...headers,
          Authorization: auth.authorization,
          "X-Amz-Date": auth.amzDate,
        },
        body: bytes as BodyInit,
      });
    } catch (error) {
      throw new StorageError("unreachable", `S3 недоступно: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      throw new StorageError("put-failed", `S3 отклонило запись: HTTP ${response.status}`);
    }
  }

  async getObject(key: string): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
    const { url } = await this.getSignedUrl(key, 60);
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new StorageError("unreachable", `S3 недоступно: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new StorageError("get-failed", `S3 отклонило чтение: HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, contentType: response.headers.get("content-type") };
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<{ url: string; expiresIn: number }> {
    const { url, expiresAt } = presignGetUrl({
      endpoint: this.config.endpoint,
      bucket: this.config.bucket,
      key,
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      expiresIn: ttlSeconds,
      pathStyle: this.config.pathStyle,
      extraQuery: { "response-content-disposition": "attachment" },
    });
    const expiresIn = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000));
    return { url, expiresIn };
  }

  async deleteObject(key: string): Promise<{ deleted: boolean }> {
    const emptyHash = sha256HexBytes(new Uint8Array(0));
    const { url, auth } = this.signed("DELETE", key, { "x-amz-content-sha256": emptyHash }, emptyHash);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: auth.authorization, "X-Amz-Date": auth.amzDate, "x-amz-content-sha256": emptyHash },
      });
    } catch (error) {
      throw new StorageError("unreachable", `S3 недоступно: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 404) {
      return { deleted: false };
    }
    if (!response.ok) {
      throw new StorageError("delete-failed", `S3 отклонило удаление: HTTP ${response.status}`);
    }
    return { deleted: true };
  }

  async headObject(key: string): Promise<StoredObjectHead | null> {
    const emptyHash = sha256HexBytes(new Uint8Array(0));
    const { url, auth } = this.signed("HEAD", key, { "x-amz-content-sha256": emptyHash }, emptyHash);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "HEAD",
        headers: { Authorization: auth.authorization, "X-Amz-Date": auth.amzDate, "x-amz-content-sha256": emptyHash },
      });
    } catch (error) {
      throw new StorageError("unreachable", `S3 недоступно: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new StorageError("head-failed", `S3 отклонило HEAD: HTTP ${response.status}`);
    }
    const length = response.headers.get("content-length");
    return {
      exists: true,
      sizeBytes: length === null ? null : Number(length),
      sha256: response.headers.get("x-amz-meta-sha256"),
    };
  }

  async listObjects(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const query: Record<string, string> = { "list-type": "2", prefix, "max-keys": "1000" };
      if (token) {
        query["continuation-token"] = token;
      }
      const emptyHash = sha256HexBytes(new Uint8Array(0));
      const { url, auth } = this.signed("GET", "", { "x-amz-content-sha256": emptyHash }, emptyHash, query);
      // Листинг — по бакету: ключ пустой, запрос строится от корня бакета.
      const listUrl = this.config.pathStyle
        ? `${this.config.endpoint.replace(/\/+$/, "")}/${encodeRfc3986(this.config.bucket)}/`
        : `${this.config.endpoint.replace("://", `://${this.config.bucket}.`)}/`;
      const withQuery = new URL(listUrl);
      for (const [k, v] of Object.entries(query)) {
        withQuery.searchParams.set(k, v);
      }
      void url;
      let response: Response;
      try {
        response = await fetch(withQuery.toString(), {
          headers: { Authorization: auth.authorization, "X-Amz-Date": auth.amzDate, "x-amz-content-sha256": emptyHash },
        });
      } catch (error) {
        throw new StorageError("unreachable", `S3 недоступно: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!response.ok) {
        throw new StorageError("list-failed", `S3 отклонило листинг: HTTP ${response.status}`);
      }
      const xml = await response.text();
      for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
        keys.push(match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      const next = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
      if (!truncated || !next) {
        break;
      }
      token = next[1];
    }
    return keys;
  }
}
