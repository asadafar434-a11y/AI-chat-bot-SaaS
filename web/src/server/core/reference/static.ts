import type {
  MedicineReferenceItem,
  MedicineReferencePort,
  MedicineReferenceSnapshot,
} from "../../../lib/core/ports/medicine-reference.ts";

export type StaticMedicineReferenceData = {
  snapshot: MedicineReferenceSnapshot;
  items?: MedicineReferenceItem[];
};

const normalizeNumber = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, "");

export const createStaticMedicineReference = (data: StaticMedicineReferenceData): MedicineReferencePort => {
  const items = new Map<string, MedicineReferenceItem>();
  for (const item of data.items ?? []) {
    const key = normalizeNumber(item.registrationNumber);
    if (items.has(key)) {
      throw new Error(`reference: дубликат registrationNumber ${item.registrationNumber}`);
    }
    items.set(key, item);
  }

  return {
    lookup: async (registrationNumber) => ({
      item: items.get(normalizeNumber(registrationNumber)) ?? null,
      snapshot: data.snapshot,
    }),
  };
};
