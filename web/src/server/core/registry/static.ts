import type { MedicineRegistrationRecord } from "../../../lib/core/modules/medical/medicine-registration.ts";
import type { RegistryRecord } from "../../../lib/core/modules/medical/registry.ts";
import type { RegistryPorts } from "../../../lib/core/ports/registry.ts";

export type StaticRegistryData = {
  devices?: Record<string, RegistryRecord>;
  medicines?: Record<string, MedicineRegistrationRecord>;
};

const normalizeNumber = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, "");

export const createStaticRegistry = (data: StaticRegistryData = {}): RegistryPorts => {
  const devices = new Map(
    Object.entries(data.devices ?? {}).map(([key, value]) => [normalizeNumber(key), value]),
  );
  const medicines = new Map(
    Object.entries(data.medicines ?? {}).map(([key, value]) => [normalizeNumber(key), value]),
  );

  return {
    devices: {
      lookup: async (query) => {
        const found = devices.get(normalizeNumber(query.registrationNumber));
        if (found) return found;
        return {
          registrationNumber: query.registrationNumber.trim(),
          status: "not_found",
          source: "static",
        };
      },
    },
    medicines: {
      lookup: async (query) => {
        const found = medicines.get(normalizeNumber(query.registrationNumber));
        if (found) return found;
        return {
          registrationNumber: query.registrationNumber.trim(),
          status: "not_found",
          source: "static",
        };
      },
    },
  };
};
