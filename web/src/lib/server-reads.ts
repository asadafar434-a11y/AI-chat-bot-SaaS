// S11 Final Read Cutover: клиентский доступ к серверному чтению.
//
// Сервер (PostgreSQL + S6) — авторитетный источник чтения. Здесь только запросы к
// существующим `/api/reads/*`; второго хранилища не создаётся, IndexedDB-фолбэка нет:
// ошибка сервера пробрасывается, а не подменяется локальными данными.
//
// Режим задаётся сборкой: `NEXT_PUBLIC_SERVER_READS=0` оставляет legacy-чтение IndexedDB
// (нужно тестам и совместимости на время dual-write). По умолчанию (в том числе в
// production) чтение серверное. Серверные эндпоинты дополнительно включаются `SERVER_READS=1`.
import type { DocMap } from "@/lib/doc-source";
import type { Fact } from "@/lib/evidence-base";
import type { FoundField } from "@/lib/my-docs";
import type { Profile } from "@/lib/profile";
import type { Purchase } from "@/lib/purchase";

/** Авторитетное чтение с сервера по умолчанию; `NEXT_PUBLIC_SERVER_READS=0` — legacy-режим (тесты/dev). */
export function serverReadsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SERVER_READS !== "0";
}

/** Ошибка серверного чтения. Никогда не превращается в IndexedDB-фолбэк. */
export class ServerReadError extends Error {
  readonly path: string;
  readonly status: number;

  constructor(path: string, status: number, message: string) {
    super(`ServerReadError: ${path} → ${status === 0 ? "сеть" : `HTTP ${status}`}: ${message}`);
    this.name = "ServerReadError";
    this.path = path;
    this.status = status;
  }
}

/** Форма документа из `GET /api/reads/documents` (совпадает с `DocumentMeta` сервиса чтения). */
export type ServerDocumentMeta = {
  id: string;
  name: string;
  scan: boolean;
  sizeBytes: number | null;
  sha256: string | null;
  ocr: boolean;
  readError: string | null;
  mimeType: string | null;
  text: string | null;
  map: DocMap | null;
  textStatus: "available" | "missing";
};

/** Форма образца из `GET /api/reads/samples` (совпадает с `SampleMeta`). */
export type ServerSampleMeta = {
  id: string;
  name: string | null;
  kinds: string[];
  about: string;
  addedAt: string | null;
  scan: boolean;
  text: string | null;
  map: DocMap | null;
  textStatus: "available" | "missing";
};

/** Форма профиля из `GET /api/reads/profile` (совпадает с результатом `readProfile`). */
export type ServerProfile = {
  profile: Profile;
  meta: { version: number; sources: Record<string, string>; suggestions: FoundField[] };
  userId: string;
};

/** Ответ серверного чтения всегда обёрнут источником: `{ source, data }`. */
type Envelope<T> = { source: string; data: T };

async function requestData<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" }, credentials: "same-origin" });
  } catch (error) {
    throw new ServerReadError(path, 0, error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ServerReadError(path, response.status, text.slice(0, 200));
  }
  const body = (await response.json()) as Envelope<T>;
  return body.data;
}

/** Чтение с сервера; 404 — `null` (запись отсутствует в доступе), остальной отказ — ошибка. */
async function requestDataOrNull<T>(path: string): Promise<T | null> {
  try {
    return await requestData<T>(path);
  } catch (error) {
    if (error instanceof ServerReadError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export function fetchPurchases(): Promise<Purchase[]> {
  return requestData<Purchase[]>("/api/reads/purchases");
}

export function fetchPurchase(id: string): Promise<Purchase | null> {
  return requestDataOrNull<Purchase>(`/api/reads/purchases/${encodeURIComponent(id)}`);
}

export function fetchDocumentMetas(purchaseId: string): Promise<ServerDocumentMeta[]> {
  return requestData<ServerDocumentMeta[]>(`/api/reads/documents?purchaseId=${encodeURIComponent(purchaseId)}`);
}

export function fetchSamples(): Promise<ServerSampleMeta[]> {
  return requestData<ServerSampleMeta[]>("/api/reads/samples");
}

export function fetchFacts(): Promise<Fact[]> {
  return requestData<Fact[]>("/api/reads/facts");
}

// Профиль и метаданные приходят одним ответом; параллельные вызовы (getProfile и
// getProfileMeta) делят один запрос. Кэш живёт только до завершения запроса — после
// мутации подписчики перечитывают данные заново.
let profileInFlight: Promise<ServerProfile> | null = null;
export function fetchProfile(): Promise<ServerProfile> {
  if (!profileInFlight) {
    profileInFlight = requestData<ServerProfile>("/api/reads/profile").finally(() => {
      profileInFlight = null;
    });
  }
  return profileInFlight;
}
