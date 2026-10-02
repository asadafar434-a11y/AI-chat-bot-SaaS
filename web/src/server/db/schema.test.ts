import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Инварианты схемы S1.
 *
 * Тест читает `prisma/schema.prisma` как текст. Это сознательный выбор: он проверяет то,
 * что зафиксировано контрактом, и не требует ни БД, ни сгенерированного клиента. Ошибка
 * в схеме должна останавливать сборку, а не обнаруживаться при первом обращении к БД в
 * разработке.
 */

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "..", "..", "prisma", "schema.prisma");
const schema = readFileSync(schemaPath, "utf8");

/** Таблицы, зафиксированные контрактом для этапа S1. */
const S1_MODELS = [
  "Organization",
  "User",
  "Membership",
  "OrganizationProfile",
  "UserProfile",
  "Purchase",
  "Document",
  "Fact",
  "Sample",
  "AuditEvent",
  "LegacyImportBatch",
] as const;

/** Таблицы, которые заведены в более поздних этапах и не должны появляться в S1. */
const LATER_STAGE_MODELS = [
  "Session",
  "Account",
  "VerificationToken",
  "Invitation",
  "Payment",
  "pgboss",
] as const;

function modelBlock(name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  assert.notEqual(start, -1, `модель ${name} не найдена`);
  const end = schema.indexOf("\n}", start);
  assert.notEqual(end, -1, `не найден конец модели ${name}`);
  return schema.slice(start, end);
}

function modelNames(): string[] {
  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]);
}

test("в схеме ровно 11 моделей S1", () => {
  assert.deepEqual(modelNames().sort(), [...S1_MODELS].sort());
});

test("моделей поздних этапов в схеме S1 нет", () => {
  const present = modelNames();
  for (const name of LATER_STAGE_MODELS) {
    assert.equal(present.includes(name), false, `${name} не должна появляться на этапе S1`);
  }
});

/**
 * Таблицы без `organizationId` — по умыслу, а не по недосмотру.
 * `Organization` сама является корнем скоупа, `User` может состоять в нескольких
 * организациях, `UserProfile` принадлежит пользователю, а не арендатору.
 */
const TABLES_WITHOUT_ORG_ID = ["Organization", "User", "UserProfile"];

/**
 * Таблицы, у которых вместо `createdAt`/`updatedAt` собственные отметки времени:
 * пакет импорта фиксирует начало и конец переноса, а не правку строки.
 */
const TABLES_WITH_OWN_TIMESTAMPS: Record<string, { created: string; updated: string }> = {
  LegacyImportBatch: { created: "startedAt", updated: "finishedAt" },
};

test("модели без organizationId — только корень и таблицы пользователя", () => {
  const withoutScope = modelNames().filter((name) => !modelBlock(name).includes("organizationId"));
  assert.deepEqual(withoutScope.sort(), [...TABLES_WITHOUT_ORG_ID].sort());
});

/** Строка объявления связи на организацию: `organization Organization @relation(...)`. */
function organizationRelationLine(name: string): string {
  const line = modelBlock(name)
    .split("\n")
    .find((entry) => entry.includes("@relation(fields: [organizationId]"));
  assert.ok(line, `${name}: не найдена связь по organizationId`);
  return line;
}

test("у каждой арендаторной таблицы есть внешний ключ на Organization", () => {
  for (const name of modelNames()) {
    if (TABLES_WITHOUT_ORG_ID.includes(name)) {
      continue;
    }
    assert.match(
      organizationRelationLine(name),
      /organization\s+Organization\s+@relation\(fields:\s*\[organizationId\]/,
      `${name}: organizationId должен ссылаться на Organization`,
    );
  }
});

test("удаление организации не каскадит в арендаторные таблицы", () => {
  for (const name of modelNames()) {
    if (TABLES_WITHOUT_ORG_ID.includes(name)) {
      continue;
    }
    const onDelete = organizationRelationLine(name).match(/onDelete:\s*(\w+)/);
    assert.ok(onDelete, `${name}: у organizationId должен быть явный onDelete`);
    assert.equal(
      onDelete[1],
      "Restrict",
      `${name}: удаление организации должно блокироваться, а не каскадить (сейчас ${onDelete[1]})`,
    );
  }
});

test("у каждой таблицы есть отметки времени создания и изменения", () => {
  for (const name of modelNames()) {
    const block = modelBlock(name);
    const own = TABLES_WITH_OWN_TIMESTAMPS[name];
    const created = own ? own.created : "createdAt";
    const updated = own ? own.updated : "updatedAt";

    assert.match(block, new RegExp(`${created}\\s+DateTime`), `${name}: нет ${created}`);

    if (name === "AuditEvent" || own) {
      // Аудит и пакет импорта только дополняются — метка правки у них не нужна.
      assert.doesNotMatch(block, /updatedAt\s+DateTime/, `${name}: не должен обновляться, поэтому updatedAt не нужен`);
      continue;
    }
    assert.match(block, new RegExp(`${updated}\\s+DateTime`), `${name}: нет ${updated}`);
  }
});

test("все идентификаторы непрозрачные и генерируются на стороне Prisma", () => {
  for (const name of modelNames()) {
    assert.match(modelBlock(name), /id\s+String\s+@id\s+@default\(cuid\(\)\)/, `${name}: id должен быть cuid()`);
  }
});

test("Purchase.payload — JSONB, а не текст", () => {
  assert.match(modelBlock("Purchase"), /payload\s+Json/);
  assert.doesNotMatch(modelBlock("Purchase"), /payload\s+String/);
});

test("Document не хранит содержимое файла, только ссылки и метаданные", () => {
  const block = modelBlock("Document");
  assert.match(block, /storageKey\s+String\?/, "ожидается ссылка на объект в хранилище");
  assert.match(block, /textKey\s+String\?/, "ожидается ссылка на извлечённый текст");
  assert.match(block, /mimeType/, "ожидается метаданные файла");
  // Колонка с текстом документа была бы скрытым ограничением на размер строки.
  assert.doesNotMatch(block, /\bcontent\s+String/, "содержимое документа не хранится в БД");
  assert.doesNotMatch(block, /\btext\s+String/, "текст документа не хранится в БД");
});

test("роли ограничены owner и member", () => {
  const role = schema.match(/enum\s+Role\s*\{([\s\S]*?)\}/);
  assert.ok(role, "enum Role не найден");
  assert.deepEqual([...role[1].matchAll(/(\w+)/g)].map((match) => match[1]), ["owner", "member"]);
});

test("статус пакета импорта ограничен enum, а не свободной строкой", () => {
  const status = schema.match(/enum\s+ImportBatchStatus\s*\{([\s\S]*?)\}/);
  assert.ok(status, "enum ImportBatchStatus не найден");
  assert.deepEqual(
    [...status[1].matchAll(/(\w+)/g)].map((match) => match[1]),
    ["started", "running", "completed", "failed"],
  );
  assert.match(
    modelBlock("LegacyImportBatch"),
    /status\s+ImportBatchStatus/,
    "статус пакета должен быть enum, а не String",
  );
});

test("пакет импорта идемпотентен по ключу и по хешу бэкапа в организации", () => {
  const block = modelBlock("LegacyImportBatch");
  assert.match(block, /batchKey\s+String\s+@unique/);
  assert.match(block, /@@unique\(\[backupHash,\s*organizationId\]/);
});

test("аудит неизменяем по построению: нет операций обновления", () => {
  const block = modelBlock("AuditEvent");
  assert.match(block, /action\s+String/);
  assert.match(block, /entityType\s+String/);
  // Отсутствие updatedAt в тесте выше — первая половина этого правила.
  assert.doesNotMatch(block, /deletedAt/, "аудит не удаляется");
});

test("у каждой арендаторной таблицы есть индекс, пригодный для выборки по организации", () => {
  for (const name of modelNames()) {
    if (TABLES_WITHOUT_ORG_ID.includes(name)) {
      continue;
    }
    const block = modelBlock(name);
    // Индекс подходит, если organizationId стоит первым в @@index либо сам уникален:
    // уникальное поле тоже создаёт индекс, пригодный для поиска по равенству.
    const hasScopedIndex =
      /@@index\(\[organizationId[^\]]*\]\)/.test(block) || /organizationId\s+String\s+@unique/.test(block);
    assert.ok(hasScopedIndex, `${name}: нужен индекс по organizationId для скоупленных выборок`);
  }
});

test("удаление пользователя мягкое: в таблице есть признак удаления", () => {
  assert.match(modelBlock("User"), /deletedAt\s+DateTime\?/);
  assert.match(modelBlock("Organization"), /deletedAt\s+DateTime\?/);
});

test("у документа есть составной индекс по организации и закупке", () => {
  assert.match(modelBlock("Document"), /@@index\(\[organizationId,\s*purchaseId\]\)/);
});
