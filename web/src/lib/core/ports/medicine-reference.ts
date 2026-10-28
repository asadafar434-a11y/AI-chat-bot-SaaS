export type MedicineReferenceItem = {
  registrationNumber: string;
  zhvnlp: boolean;
  maxPrice?: number;
  vatRate?: number;
};

export type MedicineReferenceSnapshot = {
  source: string;
  edition: string;
  effectiveFrom: string;
  complete: boolean;
};

export type MedicineReferenceLookup = {
  item: MedicineReferenceItem | null;
  snapshot: MedicineReferenceSnapshot;
};

export type MedicineReferencePort = {
  lookup(registrationNumber: string): Promise<MedicineReferenceLookup>;
};

export class MedicineReferenceNotConfiguredError extends Error {
  readonly code = "MEDICINE_REFERENCE_NOT_CONFIGURED";

  constructor() {
    super("Справочник лекарств не настроен");
    this.name = "MedicineReferenceNotConfiguredError";
  }
}
