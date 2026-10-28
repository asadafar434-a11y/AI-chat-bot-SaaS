import type { FlowInput } from "../../../lib/core/flow/types.ts";
import {
  MedicineReferenceNotConfiguredError,
  type MedicineReferencePort,
} from "../../../lib/core/ports/medicine-reference.ts";

export type ReferenceEnrichmentMeta = {
  source: string;
  edition: string;
  effectiveFrom: string;
};

export type EnrichedReferenceInput = {
  input: FlowInput;
  reference?: ReferenceEnrichmentMeta;
};

const text = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const hasValue = (value: unknown): boolean => value !== undefined && value !== null;

const hasEvidence = (input: FlowInput, key: string): boolean => {
  const item = input.evidence?.[key];
  return Boolean(item && typeof item.source === "string" && item.source.trim().length > 0);
};

export async function enrichMedicineReferenceWithMeta(
  input: FlowInput,
  port: MedicineReferencePort,
  moduleKey: string,
): Promise<EnrichedReferenceInput> {
  if (moduleKey !== "medical") return { input };
  if (text(input.data.productKind) !== "medicine") return { input };

  const registrationNumber = text(input.data.medicineRegistration);
  if (!registrationNumber) return { input };

  let lookup;
  try {
    lookup = await port.lookup(registrationNumber);
  } catch (error) {
    if (error instanceof MedicineReferenceNotConfiguredError) return { input };
    throw error;
  }

  const data = { ...input.data };
  const evidence = { ...(input.evidence ?? {}) };
  let changed = false;

  if (!hasValue(data.zhvnlpApplies)) {
    if (lookup.item) {
      data.zhvnlpApplies = lookup.item.zhvnlp;
      changed = true;
    } else if (lookup.snapshot.complete) {
      data.zhvnlpApplies = false;
      changed = true;
    }
  }

  if (lookup.item?.maxPrice !== undefined && !hasEvidence(input, "zhvnlpMaxPrice")) {
    evidence.zhvnlpMaxPrice = {
      value: lookup.item.maxPrice,
      source: `${lookup.snapshot.source}, редакция ${lookup.snapshot.edition}`,
      quote: `Действует с ${lookup.snapshot.effectiveFrom}`,
    };
    changed = true;
  }

  if (lookup.item?.vatRate !== undefined && !hasEvidence(input, "vatRateExpected")) {
    evidence.vatRateExpected = {
      value: lookup.item.vatRate,
      source: `${lookup.snapshot.source}, редакция ${lookup.snapshot.edition}`,
      quote: `Действует с ${lookup.snapshot.effectiveFrom}`,
    };
    changed = true;
  }

  if (!changed) return { input };

  return {
    input: { ...input, data, evidence },
    reference: {
      source: lookup.snapshot.source,
      edition: lookup.snapshot.edition,
      effectiveFrom: lookup.snapshot.effectiveFrom,
    },
  };
}

export async function enrichMedicineReference(
  input: FlowInput,
  port: MedicineReferencePort,
  moduleKey: string,
): Promise<FlowInput> {
  return (await enrichMedicineReferenceWithMeta(input, port, moduleKey)).input;
}
