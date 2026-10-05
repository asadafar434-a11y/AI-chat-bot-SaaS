/**
 * EIS Collector v1 — discovery закупок и получение документов.
 *
 * Общий интерфейс EisAdapter + два адаптера:
 * - Eis44Adapter: SOAP СОИ 44-ФЗ (getDocsByOrgRegion / getDocsByReestrNumber).
 * - Eis223Adapter: архитектурная заглушка 223-ФЗ (NOT_IMPLEMENTED + TODO).
 *
 * UNCONFIRMED (источник — сторонний разбор SOAP СОИ, Habr 12.2024):
 * endpoint, имена методов, порядок тегов selectionParams, subsystemType=PRIZ,
 * periodInfo/exactDate. TODO: сверить с официальной XSD getDocsIP-ws-api.xsd
 * и «Инструкцией по использованию сервисов отдачи информации ЕИС».
 * Диапазон дат реализован как по-дневные запросы exactDate, т.к. параметр
 * диапазона официально НЕ подтверждён (TODO: заменить, когда будет схема).
 */

import { randomUUID } from "node:crypto";
import { EisHttpClient } from "./client.ts";
import {
  archiveEntryToMetadata,
  attachmentRefToMetadata,
  escapeXml,
  parseArchiveUrls,
  parseAttachmentRefs,
  parseRegistryNumber,
  parseRegistryNumbers,
  splitArchivePayload,
} from "./documents.ts";
import { EisError } from "./errors.ts";
import type { EisDiscoveryFilters, EisDocumentMetadata, EisLaw, EisTenderRef } from "./types.ts";

export interface EisAdapter {
  readonly law: EisLaw;
  discoverTenders(filters: EisDiscoveryFilters, maxTenders: number): Promise<EisTenderRef[]>;
  getTenderDocuments(tender: EisTenderRef): Promise<EisDocumentMetadata[]>;
  downloadDocument(doc: EisDocumentMetadata): Promise<{ bytes: Uint8Array; contentType?: string }>;
}

/**
 * UNCONFIRMED: значение подсистемы из стороннего примера.
 * TODO: взять перечень subsystemType из официальной XSD.
 */
const DEFAULT_SUBSYSTEM_TYPE_44 = "PRIZ";

/** Ограничение по-дневной итерации: защита от веерных запросов при широком диапазоне. */
const MAX_DISCOVERY_DAYS = 31;

const SOAP_NS = "http://zakupki.gov.ru/fz44/get-docs-ip/ws";

function buildIndex(): string {
  // Формат createDateTime из стороннего примера: без миллисекунд и зоны.
  const createDateTime = new Date().toISOString().slice(0, 19);
  return `<index><id>${randomUUID()}</id><createDateTime>${createDateTime}</createDateTime><mode>PROD</mode></index>`;
}

function envelope(token: string, method: string, inner: string): string {
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="${SOAP_NS}">` +
    `<soapenv:Header><individualPerson_token>${escapeXml(token)}</individualPerson_token></soapenv:Header>` +
    `<soapenv:Body><ws:${method}>${buildIndex()}${inner}</ws:${method}></soapenv:Body></soapenv:Envelope>`
  );
}

/**
 * UNCONFIRMED: порядок selectionParams (orgRegion, subsystemType,
 * documentType44, periodInfo) — из стороннего примера. Порядок важен для
 * валидации на стороне ЕИС; TODO сверить с XSD.
 */
export function buildOrgRegionEnvelope(opts: {
  token: string;
  region?: string;
  subsystemType?: string;
  documentType44?: string;
  exactDate?: string;
}): string {
  const parts: string[] = [];
  if (opts.region) parts.push(`<orgRegion>${escapeXml(opts.region)}</orgRegion>`);
  parts.push(`<subsystemType>${escapeXml(opts.subsystemType ?? DEFAULT_SUBSYSTEM_TYPE_44)}</subsystemType>`);
  if (opts.documentType44) parts.push(`<documentType44>${escapeXml(opts.documentType44)}</documentType44>`);
  if (opts.exactDate) parts.push(`<periodInfo><exactDate>${escapeXml(opts.exactDate)}</exactDate></periodInfo>`);
  return envelope(opts.token, "getDocsByOrgRegionRequest", `<selectionParams>${parts.join("")}</selectionParams>`);
}

/** UNCONFIRMED: порядок (subsystemType, reestrNumber) — из стороннего примера. TODO сверить с XSD. */
export function buildReestrNumberEnvelope(opts: { token: string; registryNumber: string; subsystemType?: string }): string {
  const number = parseRegistryNumber(opts.registryNumber);
  const inner =
    `<selectionParams><subsystemType>${escapeXml(opts.subsystemType ?? DEFAULT_SUBSYSTEM_TYPE_44)}</subsystemType>` +
    `<reestrNumber>${escapeXml(number)}</reestrNumber></selectionParams>`;
  return envelope(opts.token, "getDocsByReestrNumberRequest", inner);
}

/** Дни диапазона включительно (YYYY-MM-DD). */
export function enumerateDays(dateFrom?: string, dateTo?: string): string[] {
  if (!dateFrom && !dateTo) return [];
  const from = dateFrom ?? dateTo ?? "";
  const to = dateTo ?? dateFrom ?? "";
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) {
    throw new EisError("VALIDATION_ERROR", `Некорректный диапазон дат: ${dateFrom}..${dateTo}`);
  }
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (days.length > MAX_DISCOVERY_DAYS) {
      throw new EisError(
        "VALIDATION_ERROR",
        `Диапазон ${from}..${to} превышает лимит по-дневного discovery v1 (${MAX_DISCOVERY_DAYS} дней). ` +
          "Сузьте диапазон: параметр диапазона дат официально не подтверждён (TODO в discovery.ts).",
      );
    }
  }
  return days;
}

export class Eis44Adapter implements EisAdapter {
  readonly law: EisLaw = "44fz";
  /** Кэш скачанных архивов по registryNumber (один тендер — одно скачивание архива). */
  private readonly archiveCache = new Map<string, { source: string; payload: Uint8Array }>();
  private readonly client: EisHttpClient;
  private readonly token: string;

  constructor(client: EisHttpClient, token: string) {
    this.client = client;
    this.token = token;
  }

  async discoverTenders(filters: EisDiscoveryFilters, maxTenders: number): Promise<EisTenderRef[]> {
    const days = enumerateDays(filters.dateFrom, filters.dateTo);
    // Без дат — один запрос без periodInfo (сервер применит свои defaults; UNCONFIRMED).
    const dates: (string | undefined)[] = days.length > 0 ? days : [undefined];
    const found: EisTenderRef[] = [];
    const seen = new Set<string>();
    for (const exactDate of dates) {
      if (found.length >= maxTenders) break;
      const xml = buildOrgRegionEnvelope({
        token: this.token,
        region: filters.region,
        documentType44: filters.procurementType,
        exactDate,
      });
      const response = await this.client.soapRequest(xml, { action: "discoverTenders/getDocsByOrgRegion" });
      const refs = parseRegistryNumbers(response, "44fz");
      const archives = parseArchiveUrls(response);
      // Архивный режим: номера могут быть только внутри архива — забираем первый архив и ищем в нём.
      if (refs.length === 0 && archives.length > 0) {
        const first = archives[0] as string;
        const { bytes } = await this.client.downloadBinary(first, "discoverTenders/downloadArchive");
        const text = new TextDecoder("utf-8").decode(bytes.slice(0, 4_000_000));
        for (const ref of parseRegistryNumbers(text, "44fz")) {
          if (seen.has(ref.registryNumber) || found.length >= maxTenders) continue;
          seen.add(ref.registryNumber);
          found.push(ref);
        }
        continue;
      }
      for (const ref of refs) {
        if (seen.has(ref.registryNumber) || found.length >= maxTenders) continue;
        seen.add(ref.registryNumber);
        found.push(ref);
      }
    }
    return found;
  }

  async getTenderDocuments(tender: EisTenderRef): Promise<EisDocumentMetadata[]> {
    const downloadedAt = new Date().toISOString();
    const { source, payload } = await this.loadTenderArchive(tender);
    const docs: EisDocumentMetadata[] = [];
    for (const entry of splitArchivePayload(payload, tender.registryNumber)) {
      docs.push(archiveEntryToMetadata(entry, tender, source, downloadedAt));
    }
    // Вложения, на которые XML ссылается внешними URL (скачиваются отдельно через downloadDocument).
    if (!isZipPayload(payload)) {
      const xmlText = new TextDecoder("utf-8").decode(payload);
      for (const ref of parseAttachmentRefs(xmlText)) {
        docs.push(attachmentRefToMetadata(ref, tender, downloadedAt));
      }
    }
    if (docs.length === 0) {
      throw new EisError("NOT_FOUND", `Документы закупки ${tender.registryNumber} не найдены в ответе СОИ`);
    }
    return docs;
  }

  async downloadDocument(doc: EisDocumentMetadata): Promise<{ bytes: Uint8Array; contentType?: string }> {
    // Вложение по внешнему URL — прямое скачивание.
    if (doc.documentType === "attachment" && doc.source && /^https?:\/\//i.test(doc.source)) {
      return this.client.downloadBinary(doc.source, "downloadDocument/attachment");
    }
    // Запись архива — из кэшированного payload тендера.
    const tender: EisTenderRef = { registryNumber: doc.tenderRegistryNumber, law: doc.law };
    const { payload } = await this.loadTenderArchive(tender);
    const entries = splitArchivePayload(payload, tender.registryNumber);
    const entry = entries.find((e) => e.fileName === doc.documentId);
    if (!entry) {
      throw new EisError("NOT_FOUND", `Запись ${doc.documentId} не найдена в архиве закупки ${doc.tenderRegistryNumber}`);
    }
    return { bytes: entry.bytes, contentType: entry.contentType };
  }

  private async loadTenderArchive(tender: EisTenderRef): Promise<{ source: string; payload: Uint8Array }> {
    const cached = this.archiveCache.get(tender.registryNumber);
    if (cached) return cached;
    const xml = buildReestrNumberEnvelope({ token: this.token, registryNumber: tender.registryNumber });
    const response = await this.client.soapRequest(xml, { action: "getTenderDocuments/getDocsByReestrNumber" });
    const archives = parseArchiveUrls(response);
    const source = archives[0];
    if (!source) {
      // Синхронный режим: ответ уже содержит документы — сохраняем сам ответ как payload.
      const payload = new TextEncoder().encode(response);
      const entry = { source: "soap-response", payload };
      this.archiveCache.set(tender.registryNumber, entry);
      return entry;
    }
    const { bytes } = await this.client.downloadBinary(source, "getTenderDocuments/downloadArchive");
    const entry = { source, payload: bytes };
    this.archiveCache.set(tender.registryNumber, entry);
    return entry;
  }
}

function isZipPayload(payload: Uint8Array): boolean {
  return payload.length > 4 && payload[0] === 0x50 && payload[1] === 0x4b && payload[2] === 0x03 && payload[3] === 0x04;
}

/**
 * 223-ФЗ: архитектурная заглушка.
 * Контур 223-ФЗ в ЕИС отделён от 44-ФЗ (свои разделы, потоки и форматы:
 * «Форматы информационного взаимодействия по 223-ФЗ», sectionId=386).
 * TODO: подтвердить endpoint/методы/авторизацию СОИ 223-ФЗ по официальной
 * документации и реализовать Eis223Adapter по интерфейсу EisAdapter.
 */
export class Eis223Adapter implements EisAdapter {
  readonly law: EisLaw = "223fz";

  private notReady(method: string): EisError {
    return new EisError(
      "NOT_IMPLEMENTED",
      `223-ФЗ: метод ${method} не реализован в v1. ` +
        "Требуется подтвердить endpoint/методы/авторизацию СОИ 223-ФЗ по официальной " +
        "документации («Форматы информационного взаимодействия по 223-ФЗ»). " +
        "См. TODO в discovery.ts и README модуля.",
    );
  }

  async discoverTenders(filters: EisDiscoveryFilters, maxTenders: number): Promise<EisTenderRef[]> {
    throw this.notReady(`discoverTenders(law=${filters.law}, max=${maxTenders})`);
  }

  async getTenderDocuments(tender: EisTenderRef): Promise<EisDocumentMetadata[]> {
    throw this.notReady(`getTenderDocuments(${tender.registryNumber})`);
  }

  async downloadDocument(doc: EisDocumentMetadata): Promise<{ bytes: Uint8Array; contentType?: string }> {
    throw this.notReady(`downloadDocument(${doc.documentId})`);
  }
}

export function createAdapter(law: EisLaw, client: EisHttpClient, token: string): EisAdapter {
  if (law === "44fz") return new Eis44Adapter(client, token);
  return new Eis223Adapter();
}
