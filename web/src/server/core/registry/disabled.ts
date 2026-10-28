import { RegistryNotConfiguredError, type RegistryPorts } from "../../../lib/core/ports/registry.ts";

export const createDisabledRegistry = (): RegistryPorts => ({
  devices: {
    lookup: async () => {
      throw new RegistryNotConfiguredError("devices");
    },
  },
  medicines: {
    lookup: async () => {
      throw new RegistryNotConfiguredError("medicines");
    },
  },
});
