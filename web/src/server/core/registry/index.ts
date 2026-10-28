import type { RegistryPorts } from "../../../lib/core/ports/registry.ts";
import { createDisabledRegistry } from "./disabled.ts";
import { createFileRegistry } from "./file.ts";
import { createHttpRegistry } from "./http.ts";
import { createStaticRegistry } from "./static.ts";

export const createRegistryPorts = async (
  provider = process.env.REGISTRY_PROVIDER ?? "disabled",
): Promise<RegistryPorts> => {
  if (provider === "disabled") return createDisabledRegistry();
  if (provider === "static") return createStaticRegistry();
  if (provider === "file") {
    const filePath = (process.env.REGISTRY_FILE ?? "").trim();
    if (!filePath) throw new Error("registry: нет переменной REGISTRY_FILE");
    return createFileRegistry(filePath);
  }
  if (provider === "http") {
    const baseUrl = (process.env.REGISTRY_HTTP_URL ?? "").trim();
    if (!baseUrl) throw new Error("registry: нет переменной REGISTRY_HTTP_URL");
    return createHttpRegistry({
      baseUrl,
      token: (process.env.REGISTRY_HTTP_TOKEN ?? "").trim() || undefined,
      timeoutMs: Number(process.env.REGISTRY_HTTP_TIMEOUT_MS ?? "") || undefined,
    });
  }
  throw new Error(`registry: неизвестный провайдер ${provider}`);
};
