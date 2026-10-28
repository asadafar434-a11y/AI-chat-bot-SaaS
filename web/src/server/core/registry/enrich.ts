import { RegistryNotConfiguredError, type RegistryPorts } from "../../../lib/core/ports/registry.ts";
import type { FlowInput } from "../../../lib/core/flow/types.ts";

export type RegistryEnrichmentMeta = {
  kind: "device" | "medicine";
  source: string;
  status: string;
  checkedAt?: string;
};

export type EnrichedCoreInput = {
  input: FlowInput;
  registry?: RegistryEnrichmentMeta;
};

const text = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const hasValue = (value: unknown): boolean => value !== undefined && value !== null;

const metaOf = (kind: "device" | "medicine", record: {
  source: string;
  status: string;
  checkedAt?: string;
}): RegistryEnrichmentMeta => ({
  kind,
  source: record.source,
  status: record.status,
  ...(record.checkedAt ? { checkedAt: record.checkedAt } : {}),
});

export async function enrichCoreInputWithMeta(
  input: FlowInput,
  ports: RegistryPorts,
  moduleKey: string,
): Promise<EnrichedCoreInput> {
  if (moduleKey !== "medical") return { input };

  const kind = text(input.data.productKind);
  if (kind === "device") {
    if (hasValue(input.data.registryRecord)) return { input };
    const registrationNumber = text(input.data.registrationCertificate);
    if (!registrationNumber) return { input };
    try {
      const record = await ports.devices.lookup({
        registrationNumber,
        model: text(input.data.registrationModel) ?? text(input.data.model),
        manufacturer: text(input.data.registrationManufacturer) ?? text(input.data.manufacturer),
      });
      return {
        input: { ...input, data: { ...input.data, registryRecord: record } },
        registry: metaOf("device", record),
      };
    } catch (error) {
      if (error instanceof RegistryNotConfiguredError) return { input };
      throw error;
    }
  }

  if (kind === "medicine") {
    if (hasValue(input.data.medicineRegistrationRecord)) return { input };
    const registrationNumber = text(input.data.medicineRegistration);
    if (!registrationNumber) return { input };
    try {
      const record = await ports.medicines.lookup({
        registrationNumber,
        name: text(input.data.medicineName),
        form: text(input.data.medicineForm),
        dosage: text(input.data.medicineDosage),
        manufacturer: text(input.data.medicineManufacturer),
      });
      return {
        input: { ...input, data: { ...input.data, medicineRegistrationRecord: record } },
        registry: metaOf("medicine", record),
      };
    } catch (error) {
      if (error instanceof RegistryNotConfiguredError) return { input };
      throw error;
    }
  }

  return { input };
}

export async function enrichCoreInput(input: FlowInput, ports: RegistryPorts, moduleKey: string): Promise<FlowInput> {
  return (await enrichCoreInputWithMeta(input, ports, moduleKey)).input;
}
