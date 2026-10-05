/**
 * EIS Collector v1 — конфигурация (только через ENV).
 *
 * ВАЖНО про схему авторизации (проверено 2026-10-03):
 * - Исторический анонимный FTP (ftp://ftp.zakupki.gov.ru) ЗАКРЫТ оператором
 *   с 01.07.2024 (новость ЕИС newsId=34208; Infoculture finguide). НЕ использовать.
 * - Актуальный машиночитаемый канал — Сервисы Отдачи Информации (СОИ), SOAP/XML,
 *   по «Инструкции по использованию сервисов отдачи информации ЕИС для ЮЛ и ФЛ»
 *   и форматам информационного взаимодействия (раздел «Документы» ЕИС).
 * - Токен физлица выдаётся через https://zakupki.gov.ru/pmd/auth/welcome
 *   (авторизация через Госуслуги). Подтверждено сторонним разбором (Habr 12.2024),
 *   сверить с актуальной официальной инструкцией перед production-запуском.
 * - Никакой официальной схемы EIS_USERNAME/EIS_PASSWORD либо
 *   EIS_CLIENT_ID/EIS_CLIENT_SECRET для публичного discovery НЕ подтверждено:
 *   эти переменные принимаются для совместимости, но без EIS_AUTH_TOKEN
 *   коллектор отказывается работать (CONFIG_ERROR) — см. loadEisConfig.
 *   TODO: сверить схему авторизации с актуальной официальной документацией СОИ.
 */

import { EisError } from "./errors.ts";
import type { EisLaw } from "./types.ts";

/**
 * UNCONFIRMED (источник — сторонний разбор SOAP СОИ, Habr 12.2024):
 * endpoint физлиц getDocsIP. Перед production сверить с официальной
 * инструкцией СОИ и XSD (getDocsIP-ws-api.xsd). Переопределяется EIS_BASE_URL.
 */
export const DEFAULT_EIS_BASE_URL = "https://int44.zakupki.gov.ru/eis-integration/services/getDocsIP";

/** Жёсткий потолок maxTenders: массовые выгрузки 10k/50k запрещены архитектурой v1. */
export const EIS_MAX_TENDERS_HARD_CAP = 1000;

export interface EisConfig {
  /** Базовый URL SOAP-сервиса СОИ. */
  baseUrl: string;
  /** Токен потребителя машиночитаемых данных (PMD). Хранится только в ENV. */
  authToken: string;
  dryRun: boolean;
  maxTenders: number;
  requestDelayMs: number;
  maxRetries: number;
  timeoutMs: number;
  /** Корень хранилища dataset (в нём создаются raw/, normalized/, progress.json). */
  storagePath: string;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value)) {
    throw new EisError("CONFIG_ERROR", `Переменная ${name} должна быть целым числом, получено: ${raw}`);
  }
  return value;
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  throw new EisError("CONFIG_ERROR", `Переменная ${name} должна быть boolean (0/1/true/false), получено: ${raw}`);
}

/**
 * Загружает и валидирует конфигурацию из ENV.
 * Overrides позволяют CLI переопределять ENV (значения CLI приоритетнее).
 * Секреты в возвращаемом объекте есть (нужны для запросов), но их ЗАПРЕЩЕНО
 * логировать: для логов использовать redactedConfig().
 */
export function loadEisConfig(overrides?: Partial<EisConfig>): EisConfig {
  const authToken = overrides?.authToken ?? process.env["EIS_AUTH_TOKEN"] ?? "";
  if (!authToken) {
    const legacyLogin = process.env["EIS_USERNAME"] ?? process.env["EIS_CLIENT_ID"] ?? "";
    throw new EisError(
      "CONFIG_ERROR",
      "EIS_AUTH_TOKEN не задан. " +
        "Токен потребителя машиночитаемых данных выдаётся через " +
        "https://zakupki.gov.ru/pmd/auth/welcome (см. README модуля). " +
        (legacyLogin
          ? "Найдены EIS_USERNAME/EIS_CLIENT_ID, но схема логин/пароль или client_credentials " +
            "официальной документацией СОИ НЕ подтверждена (TODO) и не используется."
          : "Секреты в git/логи/JSON dataset попадать не должны — только ENV.") +
        " Тесты используют mock-адаптеры и токен не требуют.",
    );
  }

  const maxTenders = overrides?.maxTenders ?? parseIntEnv("EIS_MAX_TENDERS", 100);
  if (!Number.isInteger(maxTenders) || maxTenders < 1) {
    throw new EisError("CONFIG_ERROR", `maxTenders должен быть целым >= 1, получено: ${maxTenders}`);
  }
  if (maxTenders > EIS_MAX_TENDERS_HARD_CAP) {
    throw new EisError(
      "CONFIG_ERROR",
      `maxTenders=${maxTenders} превышает жёсткий потолок v1 (${EIS_MAX_TENDERS_HARD_CAP}). ` +
        "Массовые выгрузки 10k/50k запрещены: сначала доказанная интеграция на малом объёме, затем масштабирование.",
    );
  }

  const requestDelayMs = overrides?.requestDelayMs ?? parseIntEnv("EIS_REQUEST_DELAY_MS", 1000);
  const maxRetries = overrides?.maxRetries ?? parseIntEnv("EIS_MAX_RETRIES", 3);
  const timeoutMs = overrides?.timeoutMs ?? parseIntEnv("EIS_TIMEOUT_MS", 30000);
  if (requestDelayMs < 0) throw new EisError("CONFIG_ERROR", "EIS_REQUEST_DELAY_MS не может быть отрицательным");
  if (maxRetries < 0 || maxRetries > 10) throw new EisError("CONFIG_ERROR", "EIS_MAX_RETRIES должен быть в диапазоне 0..10");
  if (timeoutMs <= 0) throw new EisError("CONFIG_ERROR", "EIS_TIMEOUT_MS должен быть положительным");

  return {
    baseUrl: overrides?.baseUrl ?? process.env["EIS_BASE_URL"] ?? DEFAULT_EIS_BASE_URL,
    authToken,
    dryRun: overrides?.dryRun ?? parseBoolEnv("EIS_DRY_RUN", true),
    maxTenders,
    requestDelayMs,
    maxRetries,
    timeoutMs,
    storagePath: overrides?.storagePath ?? process.env["EIS_STORAGE_PATH"] ?? "./data",
  };
}

/** Безопасная версия конфигурации для логов: токен замаскирован. */
export function redactedConfig(config: EisConfig): Record<string, string | number | boolean> {
  return {
    baseUrl: config.baseUrl,
    authToken: config.authToken ? "***" : "(empty)",
    dryRun: config.dryRun,
    maxTenders: config.maxTenders,
    requestDelayMs: config.requestDelayMs,
    maxRetries: config.maxRetries,
    timeoutMs: config.timeoutMs,
    storagePath: config.storagePath,
  };
}

/** Парсит и валидирует law из CLI/ENV. */
export function parseLaw(raw: string | undefined, fallback: EisLaw = "44fz"): EisLaw {
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase().replace(/[-_]/g, "");
  if (v === "44fz" || v === "44фз") return "44fz";
  if (v === "223fz" || v === "223фз") return "223fz";
  throw new EisError("CONFIG_ERROR", `Неизвестный law: ${raw}. Ожидается 44fz или 223fz.`);
}

/** Проверяет формат даты YYYY-MM-DD. */
export function parseDateParam(name: string, raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    throw new EisError("CONFIG_ERROR", `${name} должен быть в формате YYYY-MM-DD, получено: ${raw}`);
  }
  return raw.trim();
}
