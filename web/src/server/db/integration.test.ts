/**
 * Интеграционная проверка изоляции арендаторов против живой PostgreSQL.
 *
 * Тест пропускает себя сам, если не задана `TEST_DATABASE_URL`. Это осознанно: на этапе
 * S1 БД на машине разработчика может отсутствовать, и её отсутствие не должно выглядеть
 * как «проверено». Пропуск виден в выводе `node --test`, поэтому проверку нельзя
 * потерять, просто не заметив скип.
 *
 * Переменная называется `TEST_DATABASE_URL`, а не `DATABASE_URL`, намеренно: тест
 * физически не может подключиться к рабочей базе, даже если она настроена в `.env`.
 *
 * Схема должна быть развёрнута заранее — тест не применяет миграции сам:
 *   docker compose -f docker-compose.postgres.yml up -d
 *   $env:DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/tender_lawyer_test?schema=public"
 *   npx prisma migrate deploy
 *   $env:TEST_DATABASE_URL=$env:DATABASE_URL
 *   npm test
 *
 * Тест работает с отдельной базой и подчищает за собой только созданные им строки. Он не
 * вызывает `migrate reset` и не удаляет таблицы: схема принадлежит миграциям, а не тесту.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

test(
  "изоляция арендаторов: чужая организация не читает и не меняет данные",
  { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL не задан: интеграционная проверка пропущена" },
  async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = TEST_DATABASE_URL;

    const { createPrismaClient } = await import("./client.ts");
    const { orgScope } = await import("./org-scope.ts");
    const { orgRepositories, findUserInOrganization, requireOrganizationAccess } = await import(
      "./repositories/index.ts"
    );

    const prisma = createPrismaClient();

    // Идентификаторы должны укладываться в VARCHAR(25) и проходить проверку формата
    // `orgScope` (c + 20..24 строчных alphanumeric), поэтому длина фиксируется как 25.
    const mkId = (tag: string) => `c${tag}${randomBytes(11).toString("hex")}`.slice(0, 25);
    const orgId = mkId("a");
    const otherOrgId = mkId("b");
    const userId = mkId("c");

    try {
      await prisma.organization.createMany({
        data: [
          { id: orgId, name: "Организация А" },
          { id: otherOrgId, name: "Организация Б" },
        ],
      });
      await prisma.user.create({ data: { id: userId, email: `test-${userId}@example.test`, name: "Тест" } });
      await prisma.membership.create({ data: { organizationId: orgId, userId, role: "owner" } });

      const db = prisma as unknown as Parameters<typeof orgRepositories>[0];
      const repos = orgRepositories(db, orgScope(orgId));

      const created = (await repos.purchase.create({
        payload: { items: [], chat: [] },
        status: "draft",
      })) as { id: string; organizationId: string };
      assert.equal(created.organizationId, orgId, "запись должна принадлежать своей организации");

      assert.ok(await repos.purchase.getById(created.id), "закупка должна читаться в своей организации");

      const foreign = orgRepositories(db, orgScope(otherOrgId));
      assert.equal(await foreign.purchase.getById(created.id), null, "утечка чтения между организациями");
      assert.deepEqual(await foreign.purchase.list(), [], "список чужой организации должен быть пуст");
      assert.equal(await foreign.purchase.count(), 0, "подсчёт чужой организации должен быть нулевым");

      await assert.rejects(
        () => foreign.purchase.update(created.id, { status: "submitted" }),
        /NotFoundInScopeError/,
        "чужое изменение должно быть отвергнуто",
      );
      const unchanged = (await repos.purchase.getById(created.id)) as { status: string };
      assert.equal(unchanged.status, "draft", "чужое изменение не должно применяться");

      await assert.rejects(
        () => foreign.purchase.remove(created.id),
        /NotFoundInScopeError/,
        "чужое удаление должно быть отвергнуто",
      );
      assert.ok(await repos.purchase.getById(created.id), "запись должна сохраниться после чужого удаления");

      assert.equal(
        await findUserInOrganization(db, orgScope(otherOrgId), userId),
        null,
        "пользователь не должен читаться из чужой организации",
      );

      const membership = await requireOrganizationAccess(db, orgScope(orgId), userId);
      assert.equal(membership.role, "owner");
      await assert.rejects(
        () => requireOrganizationAccess(db, orgScope(otherOrgId), userId),
        /NotFoundInScopeError/,
        "доступ без членства должен быть отвергнут",
      );

      await assert.rejects(
        () => prisma.organization.delete({ where: { id: orgId } }),
        /Foreign key constraint/,
        "удаление организации должно блокироваться, пока на неё ссылаются данные",
      );

      await prisma.purchase.deleteMany({ where: { organizationId: orgId } });
      await prisma.membership.deleteMany({ where: { organizationId: orgId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    } finally {
      await prisma.$disconnect();
      if (previous === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previous;
      }
    }
  },
);
