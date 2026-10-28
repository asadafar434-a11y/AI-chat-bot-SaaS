import type { MedicineRegistrationRecord } from "../modules/medical/medicine-registration.ts";
import type { RegistryRecord } from "../modules/medical/registry.ts";

export type DeviceRegistryQuery = {
  registrationNumber: string;
  model?: string;
  manufacturer?: string;
};

export type MedicineRegistryQuery = {
  registrationNumber: string;
  name?: string;
  form?: string;
  dosage?: string;
  manufacturer?: string;
};

export type DeviceRegistryPort = {
  lookup(query: DeviceRegistryQuery): Promise<RegistryRecord>;
};

export type MedicineRegistryPort = {
  lookup(query: MedicineRegistryQuery): Promise<MedicineRegistrationRecord>;
};

export type RegistryPorts = {
  devices: DeviceRegistryPort;
  medicines: MedicineRegistryPort;
};

export class RegistryNotConfiguredError extends Error {
  readonly code = "REGISTRY_NOT_CONFIGURED";

  constructor(scope: string) {
    super(`Реестр не настроен: ${scope}`);
    this.name = "RegistryNotConfiguredError";
  }
}
