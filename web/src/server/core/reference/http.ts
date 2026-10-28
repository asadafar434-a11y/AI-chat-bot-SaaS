import type {
  MedicineReferenceItem,
  MedicineReferenceLookup,
  MedicineReferencePort,
  MedicineReferenceSnapshot,
} from "../../../lib/core/ports/medicine-reference.ts";

export type HttpMedicineReferenceConfig = {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 10_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const snapshotOf = (raw: unknown): MedicineReferenceSnapshot => {
  if (!isObject(raw)) throw new Error("reference http: snapshot не объект");
  const source = text(raw.source);
  const edition = text(raw.edition);
  const effectiveFrom = text(raw.effectiveFrom);
  if (!source) throw new Error("reference http: нет source");
  if (!edition) throw new Error("reference http: нет edition");
  if (!effectiveFrom || Number.isNaN(Date.parse(effectiveFrom))) {
    throw new Error("reference http: некорректный effectiveFrom");
  }
  if (typeof raw.complete !== "boolean") throw new Error("reference http: complete не boolean");
  return { source, edition, effectiveFrom, complete: raw.complete };
};

const itemOf = (raw: unknown): MedicineReferenceItem | null => {
  if (raw === null) return null;
  if (!isObject(raw)) throw new Error("reference http: item не объект");
  const registrationNumber = text(raw.registrationNumber);
  if (!registrationNumber) throw new Error("reference http: нет registrationNumber");
  if (typeof raw.zhvnlp !== "boolean") throw new Error("reference http: zhvnlp не boolean");
  const number = (value: unknown): number | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error("reference http: некорректное числовое поле");
    }
    return value;
  };
  const maxPrice = number(raw.maxPrice);
  const vatRate = number(raw.vatRate);
  return {
    registrationNumber,
    zhvnlp: raw.zhvnlp,
    ...(maxPrice === undefined ? {} : { maxPrice }),
    ...(vatRate === undefined ? {} : { vatRate }),
  };
};

const requestJson = async (
  config: HttpMedicineReferenceConfig,
  registrationNumber: string,
): Promise<unknown> => {
  const base = config.baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("reference http: пустой MEDICINE_REFERENCE_HTTP_URL");
  const url = `${base}/medicine-reference?${new URLSearchParams({ registrationNumber }).toString()}`;
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
    if (!response.ok) throw new Error(`reference http: HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("reference http: истёк таймаут запроса");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export function createHttpMedicineReference(config: HttpMedicineReferenceConfig): MedicineReferencePort {
  return {
    async lookup(registrationNumber: string): Promise<MedicineReferenceLookup> {
      const raw = await requestJson(config, registrationNumber);
      if (!isObject(raw)) throw new Error("reference http: ответ не объект");
      return { item: itemOf(raw.item ?? null), snapshot: snapshotOf(raw.snapshot) };
    },
  };
}
