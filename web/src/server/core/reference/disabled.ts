import {
  MedicineReferenceNotConfiguredError,
  type MedicineReferencePort,
} from "../../../lib/core/ports/medicine-reference.ts";

export const createDisabledMedicineReference = (): MedicineReferencePort => ({
  lookup: async () => {
    throw new MedicineReferenceNotConfiguredError();
  },
});
