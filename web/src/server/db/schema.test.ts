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

/** Таблицы приложения, зафиксированные контрактом для этапа S1. */
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

/** Стандартные таблицы Auth.js и таблица приглашений — добавляются на этапе S2. */
const AUTH_MODELS = ["Account", "Session", "VerificationToken"] as const;
const S2_MODELS = [...AUTH_MODELS, "Invitation"] as const;

/**
 * Таблицы базы знаний (S12). Владелец документа — общая база или организация, поэтому таблицы несут
 * `ownerKey` («global» или «org:<id>»), а не `organizationId`: у общей базы организации нет, и связь
 * с Organization невозможна. Скоуп проверяется в условии каждого запроса поиска.
 */
const KB_MODELS = ["KnowledgeDocument", "KnowledgeChunk"] as const;

/** Таблицы, которые заведены в более поздних этапах и не должны появляться сейчас. */
const LATER_STAGE_MODELS = ["Payment", "pgboss"] as const;

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

test("в схеме ровно 17 моделей: 11 приложения (S1), 4 аутентификации (S2) и 2 базы знаний (S12)", () => {
  assert.deepEqual(modelNames().sort(), [...S1_MODELS, ...S2_MODELS, ...KB_MODELS].sort());
});

test("моделей более поздних этапов в схеме нет", () => {
  const present = modelNames();
  for (const name of LATER_STAGE_MODELS) {
    assert.equal(present.includes(name), false, `${name} не должна появляться на этом этапе`);
  }
});

/**
 * Таблицы без `organizationId` — по умыслу, а не по недосмотру.
 * `Organization` сама является корнем скоупа, `User` может состоять в нескольких
 * организациях, `UserProfile` принадлежит пользователю, а не арендатору. Таблицы Auth.js
 * привязаны к `userId` текущей сессии, а не к арендатору (data-model.md §7).
 */
const TABLES_WITHOUT_ORG_ID = ["Organization", "User", "UserProfile", ...AUTH_MODELS, ...KB_MODELS];

/**
 * Таблицы, у которых вместо `createdAt`/`updatedAt` собственные отметки времени:
 * пакет импорта фиксирует начало и конец переноса, а не правку строки.
 */
const TABLES_WITH_OWN_TIMESTAMPS: Record<string, { created: string; updated: string }> = {
  LegacyImportBatch: { created: "startedAt", updated: "finishedAt" },
  // Фрагменты не правятся: при изменении документа они заменяются целиком.
  KnowledgeChunk: { created: "createdAt", updated: "createdAt" },
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

test("у каждой таблицы приложения есть отметки времени создания и изменения", () => {
  for (const name of modelNames()) {
    // Стандартные таблицы Auth.js не несут прикладных отметок времени: их форма задана
    // Auth.js, а не продуктом. Менять её — значит разойтись с адаптером.
    if ((AUTH_MODELS as readonly string[]).includes(name)) {
      continue;
    }
    const block = modelBlock(name);
    const own = TABLES_WITH_OWN_TIMESTAMPS[name];
    const created = own ? own.created : "createdAt";
    const updated = own ? own.updated : "updatedAt";

    assert.match(block, new RegExp(`${created}\\s+DateTime`), `${name}: нет ${created}`);

    // Аудит, пакет импорта и приглашение только дополняются — метка правки им не нужна:
    // приглашение фиксирует принятие через `acceptedAt`, а не через `updatedAt`.
    if (name === "AuditEvent" || name === "Invitation" || own) {
      assert.doesNotMatch(block, /updatedAt\s+DateTime/, `${name}: не должен обновляться, поэтому updatedAt не нужен`);
      continue;
    }
    assert.match(block, new RegExp(`${updated}\\s+DateTime`), `${name}: нет ${updated}`);
  }
});

test("все идентификаторы непрозрачные и генерируются на стороне Prisma", () => {
  for (const name of modelNames()) {
    // У `VerificationToken` составной ключ `@@unique([identifier, token])` вместо `id`:
    // такова стандартная модель Auth.js, и собственный `id` здесь ничего не улучшает.
    if (name === "VerificationToken") {
      continue;
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// Инварианты S2: аутентификация, сессии, приглашения
// ─────────────────────────────────────────────────────────────────────────────

test("Session: уникальный серверный токен и срок действия", () => {
  const block = modelBlock("Session");
  // Cookie хранит sessionToken, поэтому по нему должен быть уникальный поиск.
  assert.match(block, /sessionToken\s+String\s+@unique/);
  assert.match(block, /expires\s+DateTime/);
  assert.match(block, /userId\s+String/);
  // Сессия не переживает удаление пользователя: каскад по userId.
  assert.match(block, /user\s+User\s+@relation\(fields:\s*\[userId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
});

test("VerificationToken: составной ключ по identifier и token", () => {
  const block = modelBlock("VerificationToken");
  assert.match(block, /@@unique\(\[identifier,\s*token\]\)/);
  assert.match(block, /expires\s+DateTime/);
});

test("Account: внешняя учётная запись уникальна по провайдеру", () => {
  assert.match(modelBlock("Account"), /@@unique\(\[provider,\s*providerAccountId\]\)/);
});

test("Invitation хранит хеш токена, а не сам токен", () => {
  const block = modelBlock("Invitation");
  assert.match(block, /tokenHash\s+String\s+@unique/);
  // Сырое поле token отсутствует: иначе похищение таблицы позволяло бы принять приглашение.
  assert.doesNotMatch(block, /\btoken\s+String/);
});

test("Invitation несёт организацию и роль, срок и признак принятия", () => {
  const block = modelBlock("Invitation");
  assert.match(block, /organizationId\s+String/);
  assert.match(block, /role\s+Role\s+@default\(member\)/);
  assert.match(block, /expiresAt\s+DateTime/);
  assert.match(block, /acceptedAt\s+DateTime\?/);
  assert.match(block, /invitedByUserId\s+String/);
  assert.match(block, /@@index\(\[organizationId,\s*email\]\)/);
});

test("Invitation ссылается на организацию и пригласившего без каскада", () => {
  const block = modelBlock("Invitation");
  assert.match(block, /organization\s+Organization\s+@relation\(fields:\s*\[organizationId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/);
  assert.match(
    block,
    /invitedBy\s+User\s+@relation\("InvitationInvitedBy",\s*fields:\s*\[invitedByUserId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Инварианты S12: база знаний
// ─────────────────────────────────────────────────────────────────────────────

test("база знаний: документ уникален по владельцу и ключу, фрагменты — по документу и номеру", () => {
  assert.match(modelBlock("KnowledgeDocument"), /@@unique\(\[ownerKey,\s*sourceKey\]\)/);
  assert.match(modelBlock("KnowledgeChunk"), /@@unique\(\[documentId,\s*chunkIndex\]\)/);
});

test("база знаний: фрагменты удаляются вместе с документом, а не остаются сиротами", () => {
  assert.match(
    modelBlock("KnowledgeChunk"),
    /document\s+KnowledgeDocument\s+@relation\(fields:\s*\[documentId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
  );
});

test("база знаний: поиск по владельцу идёт по индексу, а владелец хранится у каждого фрагмента", () => {
  assert.match(modelBlock("KnowledgeChunk"), /ownerKey\s+String/);
  assert.match(modelBlock("KnowledgeChunk"), /@@index\(\[ownerKey,\s*hash,\s*embeddingModel\]\)/);
  assert.match(modelBlock("KnowledgeDocument"), /@@index\(\[ownerKey,\s*status\]\)/);
});

test("база знаний: векторы — массив Float, текст документа хранится только для переиндексации", () => {
  assert.match(modelBlock("KnowledgeChunk"), /embedding\s+Float\[\]/);
  assert.match(modelBlock("KnowledgeDocument"), /sourceText\s+String/);
});
