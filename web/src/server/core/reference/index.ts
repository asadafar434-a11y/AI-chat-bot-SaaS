import type { MedicineReferencePort } from "../../../lib/core/ports/medicine-reference.ts";
import { createDisabledMedicineReference } from "./disabled.ts";
import { createFileMedicineReference } from "./file.ts";
import { createHttpMedicineReference } from "./http.ts";
import { createStaticMedicineReference } from "./static.ts";

export const createMedicineReferencePort = async (
  provider = process.env.MEDICINE_REFERENCE_PROVIDER ?? "disabled",
): Promise<MedicineReferencePort> => {
  if (provider === "disabled") return createDisabledMedicineReference();
  if (provider === "static") {
    return createStaticMedicineReference({
      snapshot: {
        source: "static",
        edition: "empty",
        effectiveFrom: "1970-01-01",
        complete: false,
      },
      items: [],
    });
  }
  if (provider === "file") {
    const filePath = (process.env.MEDICINE_REFERENCE_FILE ?? "").trim();
    if (!filePath) throw new Error("reference: нет переменной MEDICINE_REFERENCE_FILE");
    return createFileMedicineReference(filePath);
  }
  if (provider === "http") {
    const baseUrl = (process.env.MEDICINE_REFERENCE_HTTP_URL ?? "").trim();
    if (!baseUrl) throw new Error("reference: нет переменной MEDICINE_REFERENCE_HTTP_URL");
    return createHttpMedicineReference({
      baseUrl,
      token: (process.env.MEDICINE_REFERENCE_HTTP_TOKEN ?? "").trim() || undefined,
      timeoutMs: Number(process.env.MEDICINE_REFERENCE_HTTP_TIMEOUT_MS ?? "") || undefined,
    });
  }
  throw new Error(`reference: неизвестный провайдер ${provider}`);
};
