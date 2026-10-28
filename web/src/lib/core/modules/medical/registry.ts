export type RegistryStatus = "active" | "expired" | "not_found";

export type RegistryRecord = {
  registrationNumber: string;
  status: RegistryStatus;
  model?: string;
  manufacturer?: string;
  source: string;
  checkedAt?: string;
};

export type RegistryMismatchReason = "not_found" | "expired" | "number" | "model" | "manufacturer";

export type RegistryCheckResult = {
  matched: boolean;
  reasons: RegistryMismatchReason[];
  missing: string[];
  detail: string;
};

export type RegistryExpected = {
  registrationNumber: string;
  model?: string;
  manufacturer?: string;
};

const normalizeText = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeNumber = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, "");

const parseRecord = (raw: unknown): RegistryRecord | null => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const registrationNumber =
    typeof record.registrationNumber === "string" ? record.registrationNumber.trim() : "";
  const source = typeof record.source === "string" ? record.source.trim() : "";
  if (registrationNumber.length === 0 || source.length === 0) return null;
  if (record.status !== "active" && record.status !== "expired" && record.status !== "not_found") return null;
  if (typeof record.checkedAt === "string" && record.checkedAt.trim().length > 0) {
    if (Number.isNaN(Date.parse(record.checkedAt))) return null;
  }
  const model = typeof record.model === "string" && record.model.trim().length > 0 ? record.model.trim() : undefined;
  const manufacturer =
    typeof record.manufacturer === "string" && record.manufacturer.trim().length > 0
      ? record.manufacturer.trim()
      : undefined;
  return {
    registrationNumber,
    status: record.status,
    model,
    manufacturer,
    source,
    checkedAt: typeof record.checkedAt === "string" ? record.checkedAt.trim() : undefined,
  };
};

export const checkRegistryRecord = (raw: unknown, expected: RegistryExpected): RegistryCheckResult => {
  const record = parseRecord(raw);
  if (!record) {
    return { matched: false, reasons: [], missing: ["registryRecord"], detail: "Некорректная запись реестра" };
  }
  if (expected.registrationNumber.trim().length === 0) {
    return {
      matched: false,
      reasons: [],
      missing: ["registrationCertificate"],
      detail: "Не указано РУ для сверки с реестром",
    };
  }

  const reasons: RegistryMismatchReason[] = [];
  if (record.status === "not_found") reasons.push("not_found");
  if (record.status === "expired") reasons.push("expired");
  if (record.status === "active") {
    if (normalizeNumber(record.registrationNumber) !== normalizeNumber(expected.registrationNumber)) {
      reasons.push("number");
    }
    if (expected.model) {
      if (!record.model || normalizeText(record.model) !== normalizeText(expected.model)) reasons.push("model");
    }
    if (expected.manufacturer) {
      if (!record.manufacturer || normalizeText(record.manufacturer) !== normalizeText(expected.manufacturer)) {
        reasons.push("manufacturer");
      }
    }
  }

  if (reasons.length > 0) {
    return {
      matched: false,
      reasons,
      missing: [],
      detail: `Реестр не подтверждает: ${reasons.join(", ")}`,
    };
  }

  return {
    matched: true,
    reasons: [],
    missing: [],
    detail: `Реестр подтверждает РУ ${record.registrationNumber}`,
  };
};
