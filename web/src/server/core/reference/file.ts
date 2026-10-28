import { readFile } from "node:fs/promises";

import type {
  MedicineReferenceItem,
  MedicineReferencePort,
  MedicineReferenceSnapshot,
} from "../../../lib/core/ports/medicine-reference.ts";
import { createStaticMedicineReference, type StaticMedicineReferenceData } from "./static.ts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const number = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
};

const parseItem = (value: unknown, index: number): MedicineReferenceItem => {
  if (!isObject(value)) throw new Error(`reference: items[${index}] должна быть объектом`);
  const registrationNumber = text(value.registrationNumber);
  if (!registrationNumber) throw new Error(`reference: items[${index}] — не указан registrationNumber`);
  if (typeof value.zhvnlp !== "boolean") throw new Error(`reference: items[${index}] — zhvnlp должен быть boolean`);

  let maxPrice: number | undefined;
  if (value.maxPrice !== undefined) {
    const parsed = number(value.maxPrice);
    if (parsed === null) throw new Error(`reference: items[${index}] — некорректный maxPrice`);
    maxPrice = parsed;
  }
  let vatRate: number | undefined;
  if (value.vatRate !== undefined) {
    const parsed = number(value.vatRate);
    if (parsed === null) throw new Error(`reference: items[${index}] — некорректный vatRate`);
    vatRate = parsed;
  }

  return {
    registrationNumber,
    zhvnlp: value.zhvnlp,
    ...(maxPrice === undefined ? {} : { maxPrice }),
    ...(vatRate === undefined ? {} : { vatRate }),
  };
};

const parseSnapshot = (raw: Record<string, unknown>): MedicineReferenceSnapshot => {
  const source = text(raw.source);
  const edition = text(raw.edition);
  const effectiveFrom = text(raw.effectiveFrom);
  if (!source) throw new Error("reference: не указан source");
  if (!edition) throw new Error("reference: не указан edition");
  if (!effectiveFrom) throw new Error("reference: не указан effectiveFrom");
  if (Number.isNaN(Date.parse(effectiveFrom))) throw new Error("reference: некорректный effectiveFrom");
  if (typeof raw.complete !== "boolean") throw new Error("reference: complete должен быть boolean");
  return { source, edition, effectiveFrom, complete: raw.complete };
};

export const readMedicineReferenceFile = async (filePath: string): Promise<StaticMedicineReferenceData> => {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    throw new Error("reference: файл справочника не найден");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error("reference: файл содержит некорректный JSON");
  }
  if (!isObject(parsed)) throw new Error("reference: файл должен содержать объект");

  const snapshot = parseSnapshot(parsed);
  if (parsed.items !== undefined && !Array.isArray(parsed.items)) {
    throw new Error("reference: items должен быть массивом");
  }
  const items = (parsed.items ?? []).map((item, index) => parseItem(item, index));
  return { snapshot, items };
};

export const createFileMedicineReference = async (filePath: string): Promise<MedicineReferencePort> => {
  const data = await readMedicineReferenceFile(filePath);
  return createStaticMedicineReference(data);
};
