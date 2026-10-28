import { readFile } from "node:fs/promises";

import type { MedicineRegistrationRecord } from "../../../lib/core/modules/medical/medicine-registration.ts";
import type { RegistryRecord } from "../../../lib/core/modules/medical/registry.ts";
import type { RegistryPorts } from "../../../lib/core/ports/registry.ts";
import { createStaticRegistry } from "./static.ts";

export type RegistryFile = {
  devices?: RegistryRecord[];
  medicines?: MedicineRegistrationRecord[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const optionalText = (record: Record<string, unknown>, key: string, scope: string): void => {
  if (record[key] === undefined) return;
  if (!text(record[key])) throw new Error(`registry: ${scope} — поле ${key} должно быть непустой строкой`);
};

const validateRecord = (value: unknown, scope: string): void => {
  if (!isObject(value)) throw new Error(`registry: ${scope} — запись должна быть объектом`);
  if (!text(value.registrationNumber)) {
    throw new Error(`registry: ${scope} — не указан registrationNumber`);
  }
  if (value.status !== "active" && value.status !== "expired" && value.status !== "not_found") {
    throw new Error(`registry: ${scope} — некорректный status`);
  }
  if (!text(value.source)) throw new Error(`registry: ${scope} — не указан source`);
  optionalText(value, "checkedAt", scope);
  if (text(value.checkedAt) && Number.isNaN(Date.parse(String(value.checkedAt)))) {
    throw new Error(`registry: ${scope} — некорректный checkedAt`);
  }
  for (const key of ["model", "manufacturer", "name", "form", "dosage"]) {
    optionalText(value, key, scope);
  }
};

const parseFile = (raw: unknown): RegistryFile => {
  if (!isObject(raw)) throw new Error("registry: файл должен содержать объект");
  if (raw.devices !== undefined && !Array.isArray(raw.devices)) {
    throw new Error("registry: devices должен быть массивом");
  }
  if (raw.medicines !== undefined && !Array.isArray(raw.medicines)) {
    throw new Error("registry: medicines должен быть массивом");
  }
  const devices = (raw.devices ?? []) as unknown[];
  const medicines = (raw.medicines ?? []) as unknown[];
  devices.forEach((record, index) => validateRecord(record, `devices[${index}]`));
  medicines.forEach((record, index) => validateRecord(record, `medicines[${index}]`));
  return { devices: devices as RegistryRecord[], medicines: medicines as MedicineRegistrationRecord[] };
};

const normalizeNumber = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, "");

const toMap = <T extends { registrationNumber: string }>(records: T[], scope: string): Record<string, T> => {
  const result: Record<string, T> = {};
  for (const record of records) {
    const key = normalizeNumber(record.registrationNumber);
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`registry: ${scope} — дубликат registrationNumber ${record.registrationNumber}`);
    }
    result[key] = record;
  }
  return result;
};

export const readRegistryFile = async (filePath: string): Promise<RegistryFile> => {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    throw new Error("registry: файл реестра не найден");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error("registry: файл содержит некорректный JSON");
  }

  return parseFile(parsed);
};

export const createFileRegistry = async (filePath: string): Promise<RegistryPorts> => {
  const data = await readRegistryFile(filePath);
  return createStaticRegistry({
    devices: toMap(data.devices ?? [], "devices"),
    medicines: toMap(data.medicines ?? [], "medicines"),
  });
};
