/**
 * EIS Collector v1 — нормализация в SILVER.
 *
 * Только объективные метаданные из ЕИС. БЕЗ LLM-извлечения, БЕЗ классификации
 * требований, БЕЗ скоринга (это следующие этапы, не v1).
 * Все поля, кроме идентификаторов и ссылок, опциональны: отсутствующие данные
 * ЕИС не додумываются.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveNormalizedDir } from "./storage.ts";
import type { EisDocumentMetadata, EisLaw, EisNormalizedTender } from "./types.ts";
import { EIS_COLLECTOR_VERSION, EIS_MANIFEST_SCHEMA_VERSION } from "./types.ts";

export interface EisRawObjectiveFields {
  customer?: string;
  customerInn?: string;
  procurementMethod?: string;
  price?: number;
  currency?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Извлекает объективные поля из сырых строк discovery/документов.
 * Числа парсятся строго (только конечные положительные), мусор отбрасывается.
 */
export function toObjectiveFields(raw: Record<string, string> | undefined): EisRawObjectiveFields {
  if (!raw) return {};
  const out: EisRawObjectiveFields = {};
  if (raw["customer"]) out.customer = raw["customer"];
  if (raw["customerInn"] && /^\d{10}(\d{2})?$/.test(raw["customerInn"].trim())) out.customerInn = raw["customerInn"].trim();
  if (raw["procurementMethod"]) out.procurementMethod = raw["procurementMethod"];
  if (raw["status"]) out.status = raw["status"];
  if (raw["currency"]) out.currency = raw["currency"];
  if (raw["dateFrom"]) out.dateFrom = raw["dateFrom"];
  if (raw["dateTo"]) out.dateTo = raw["dateTo"];
  if (raw["price"] !== undefined) {
    // Строгий разбор RU-форматов: пробелы-тысячи отбрасываем; при наличии и точек,
    // и запятой точки — тысячи; одиночная запятая — десятичный разделитель.
    const cleaned = String(raw["price"]).replace(/\s/g, "").replace(/[^0-9,.]/g, "");
    let normalized = cleaned;
    if (cleaned.includes(",") && cleaned.includes(".")) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else if (cleaned.includes(",")) {
      normalized = cleaned.replace(",", ".");
    }
    const price = Number(normalized);
    if (cleaned && Number.isFinite(price) && price > 0) out.price = price;
  }
  return out;
}

export function buildNormalizedTender(opts: {
  registryNumber: string;
  law: EisLaw;
  objective: EisRawObjectiveFields;
  documents: EisDocumentMetadata[];
}): EisNormalizedTender {
  const rawRefs = opts.documents
    .map((d) => d.localPath)
    .filter((p): p is string => Boolean(p));
  return {
    schemaVersion: EIS_MANIFEST_SCHEMA_VERSION,
    registryNumber: opts.registryNumber,
    law: opts.law,
    dateFrom: opts.objective.dateFrom,
    dateTo: opts.objective.dateTo,
    customer: opts.objective.customer,
    customerInn: opts.objective.customerInn,
    procurementMethod: opts.objective.procurementMethod,
    price: opts.objective.price,
    currency: opts.objective.currency,
    status: opts.objective.status,
    documents: opts.documents,
    rawRefs: [...new Set(rawRefs)],
    collectedAt: new Date().toISOString(),
    collectorVersion: EIS_COLLECTOR_VERSION,
  };
}

/** Пишет data/normalized/{law}/YYYY/MM/{registry}/tender.json, возвращает путь. */
export function writeNormalized(
  storagePath: string,
  law: EisLaw,
  registryNumber: string,
  tender: EisNormalizedTender,
  at: Date = new Date(),
): string {
  const dir = resolveNormalizedDir(storagePath, law, registryNumber, at);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "tender.json");
  writeFileSync(path, JSON.stringify(tender, null, 2), "utf-8");
  return path;
}
