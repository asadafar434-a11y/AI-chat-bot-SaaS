import type { MedicineRegistrationRecord } from "../../../lib/core/modules/medical/medicine-registration.ts";
import type { RegistryRecord } from "../../../lib/core/modules/medical/registry.ts";
import type { DeviceRegistryQuery, MedicineRegistryQuery, RegistryPorts } from "../../../lib/core/ports/registry.ts";

export type HttpRegistryConfig = {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 10_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const optionalText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const requireText = (value: unknown, field: string): string => {
  const text = optionalText(value);
  if (!text) throw new Error(`registry http: нет поля ${field}`);
  return text;
};

const validateStatus = (value: unknown, field: string): "active" | "expired" | "not_found" => {
  if (value !== "active" && value !== "expired" && value !== "not_found") {
    throw new Error(`registry http: некорректный ${field}`);
  }
  return value;
};

const validateCheckedAt = (value: unknown): string | undefined => {
  const text = optionalText(value);
  if (text && Number.isNaN(Date.parse(text))) throw new Error("registry http: некорректный checkedAt");
  return text;
};

const parseDevice = (raw: unknown): RegistryRecord => {
  if (!isObject(raw)) throw new Error("registry http: ответ устройства не объект");
  return {
    registrationNumber: requireText(raw.registrationNumber, "registrationNumber"),
    status: validateStatus(raw.status, "status"),
    ...(optionalText(raw.model) ? { model: optionalText(raw.model) } : {}),
    ...(optionalText(raw.manufacturer) ? { manufacturer: optionalText(raw.manufacturer) } : {}),
    source: requireText(raw.source, "source"),
    ...(validateCheckedAt(raw.checkedAt) ? { checkedAt: validateCheckedAt(raw.checkedAt) } : {}),
  };
};

const parseMedicine = (raw: unknown): MedicineRegistrationRecord => {
  if (!isObject(raw)) throw new Error("registry http: ответ лекарства не объект");
  return {
    registrationNumber: requireText(raw.registrationNumber, "registrationNumber"),
    status: validateStatus(raw.status, "status"),
    ...(optionalText(raw.name) ? { name: optionalText(raw.name) } : {}),
    ...(optionalText(raw.form) ? { form: optionalText(raw.form) } : {}),
    ...(optionalText(raw.dosage) ? { dosage: optionalText(raw.dosage) } : {}),
    ...(optionalText(raw.manufacturer) ? { manufacturer: optionalText(raw.manufacturer) } : {}),
    source: requireText(raw.source, "source"),
    ...(validateCheckedAt(raw.checkedAt) ? { checkedAt: validateCheckedAt(raw.checkedAt) } : {}),
  };
};

const queryString = (query: Record<string, string | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value.trim().length > 0) params.set(key, value.trim());
  }
  return params.toString();
};

const requestJson = async (
  config: HttpRegistryConfig,
  path: string,
  query: Record<string, string | undefined>,
): Promise<unknown> => {
  const base = config.baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("registry http: пустой REGISTRY_HTTP_URL");
  const params = queryString(query);
  const url = `${base}${path}${params ? `?${params}` : ""}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (config.fetchImpl ?? fetch)(url, {
      headers: {
        Accept: "application/json",
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`registry http: HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("registry http: истёк таймаут запроса");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const sourceOf = (config: HttpRegistryConfig): string => `http:${config.baseUrl.trim()}`;

const notFound = (config: HttpRegistryConfig, registrationNumber: string) => ({
  registrationNumber,
  status: "not_found" as const,
  source: sourceOf(config),
  checkedAt: new Date().toISOString().slice(0, 10),
});

export function createHttpRegistry(config: HttpRegistryConfig): RegistryPorts {
  return {
    devices: {
      async lookup(query: DeviceRegistryQuery) {
        const raw = await requestJson(config, "/devices/lookup", {
          registrationNumber: query.registrationNumber,
          model: query.model,
          manufacturer: query.manufacturer,
        });
        if (raw === null) return notFound(config, query.registrationNumber);
        return parseDevice(raw);
      },
    },
    medicines: {
      async lookup(query: MedicineRegistryQuery) {
        const raw = await requestJson(config, "/medicines/lookup", {
          registrationNumber: query.registrationNumber,
          name: query.name,
          form: query.form,
          dosage: query.dosage,
          manufacturer: query.manufacturer,
        });
        if (raw === null) return notFound(config, query.registrationNumber);
        return parseMedicine(raw);
      },
    },
  };
}
