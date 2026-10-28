export type MedicineRegistrationStatus = "active" | "expired" | "not_found";

export type MedicineRegistrationRecord = {
  registrationNumber: string;
  status: MedicineRegistrationStatus;
  name?: string;
  form?: string;
  dosage?: string;
  manufacturer?: string;
  source: string;
  checkedAt?: string;
};

export type MedicineRegistrationExpected = {
  registrationNumber?: string;
  name?: string;
  form?: string;
  dosage?: string;
  manufacturer?: string;
};

export type MedicineRegistrationMismatchReason =
  | "not_found"
  | "expired"
  | "number"
  | "name"
  | "form"
  | "dosage"
  | "manufacturer";

export type MedicineRegistrationCheckResult = {
  matched: boolean;
  reasons: MedicineRegistrationMismatchReason[];
  missing: string[];
  detail: string;
};

const normalizeText = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeNumber = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, "");

const parseRecord = (raw: unknown): MedicineRegistrationRecord | null => {
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
  const text = (key: string): string | undefined => {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  };
  return {
    registrationNumber,
    status: record.status,
    name: text("name"),
    form: text("form"),
    dosage: text("dosage"),
    manufacturer: text("manufacturer"),
    source,
    checkedAt: text("checkedAt"),
  };
};

export const checkMedicineRegistrationRecord = (
  raw: unknown,
  expected: MedicineRegistrationExpected
): MedicineRegistrationCheckResult => {
  const record = parseRecord(raw);
  if (!record) {
    return { matched: false, reasons: [], missing: ["medicineRegistrationRecord"], detail: "Некорректная запись РУ" };
  }

  const reasons: MedicineRegistrationMismatchReason[] = [];
  if (record.status === "not_found") reasons.push("not_found");
  if (record.status === "expired") reasons.push("expired");
  if (record.status === "active") {
    if (expected.registrationNumber && normalizeNumber(record.registrationNumber) !== normalizeNumber(expected.registrationNumber)) {
      reasons.push("number");
    }
    if (expected.name && (!record.name || normalizeText(record.name) !== normalizeText(expected.name))) {
      reasons.push("name");
    }
    if (expected.form && (!record.form || normalizeText(record.form) !== normalizeText(expected.form))) {
      reasons.push("form");
    }
    if (expected.dosage && (!record.dosage || normalizeText(record.dosage) !== normalizeText(expected.dosage))) {
      reasons.push("dosage");
    }
    if (
      expected.manufacturer &&
      (!record.manufacturer || normalizeText(record.manufacturer) !== normalizeText(expected.manufacturer))
    ) {
      reasons.push("manufacturer");
    }
  }

  if (reasons.length > 0) {
    return {
      matched: false,
      reasons,
      missing: [],
      detail: `РУ не подтверждает: ${reasons.join(", ")}`,
    };
  }

  return {
    matched: true,
    reasons: [],
    missing: [],
    detail: `РУ подтверждает ${record.registrationNumber}`,
  };
};
