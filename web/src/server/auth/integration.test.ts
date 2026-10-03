/**
 * Интеграционная проверка серверной аутентификации против живой PostgreSQL.
 *
 * Тест пропускает себя сам, если не задана `TEST_DATABASE_URL`, — как и S1-проверка
 * изоляции арендаторов. Схема должна быть развёрнута заранее (`prisma migrate deploy`);
 * тест не применяет миграции и не делает `migrate reset`.
 *
 * Проверяются реальные свойства протокола, а не моки: сохранение и отзыв сессий,
 * одноразовость приглашения и сброса пароля, ограничение ролей, защита последнего
 * владельца и отказ в доступе к чужой организации. Транзакции идут через настоящий
 * `getTransactionRunner()`, поэтому проверяется и работа `$transaction`.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (TEST_DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

after(async () => {
  const { disconnectPrisma } = await import("../db/client.ts");
  await disconnectPrisma();
});

/** Идентификатор вида cuid(): `c` + 20..24 строчных alnum, укладывается в VARCHAR(25). */
function mkId(tag: string): string {
  return `c${tag}${randomBytes(10).toString("hex")}`.slice(0, 25);
}

const skip = TEST_DATABASE_URL ? false : "TEST_DATABASE_URL не задан: интеграционная проверка пропущена";

test("S2: вход паролем, серверная сессия и её отзыв", { skip }, async () => {
  const { createPrismaClient } = await import("../db/client.ts");
  const { authenticateWithPassword } = await import("./credentials.ts");
  const { createSession, deleteSession, getActiveSession, getSessionAndUser } = await import("./session.ts");
  const { hashPassword } = await import("./password.ts");

  const prisma = createPrismaClient();
  const db = prisma as unknown as Parameters<typeof authenticateWithPassword>[0];
  const orgId = mkId("a");
  const userId = mkId("b");
  const email = `${userId}@example.test`;

  try {
    await prisma.organization.create({ data: { id: orgId, name: "Организация" } });
    await prisma.user.create({ data: { id: userId, email, passwordHash: await hashPassword("db-password-1") } });
    await prisma.membership.create({ data: { organizationId: orgId, userId, role: "owner" } });

    const authenticated = await authenticateWithPassword(db, { email: email.toUpperCase(), password: "db-password-1" });
    assert.equal(authenticated?.userId, userId, "вход по нормализованному email");

    const { token } = await createSession(db, { userId });
    const found = await getSessionAndUser(db, token);
    assert.equal(found?.user.id, userId, "сессия читается вместе с пользователем");

    assert.equal(await deleteSession(db, token), 1);
    assert.equal(await getActiveSession(db, token), null, "после выхода сессия не читается");

    const { token: second } = await createSession(db, { userId });
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    assert.equal(
      await authenticateWithPassword(db, { email, password: "db-password-1" }),
      null,
      "удалённый пользователь не входит по верному паролю",
    );
    assert.equal(await getSessionAndUser(db, second), null, "сессия удалённого пользователя отзывается");

    await prisma.user.update({ where: { id: userId }, data: { deletedAt: null } });
  } finally {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  }
});

test("S2: приглашение принимается один раз и создаёт членство", { skip }, async () => {
  const { createPrismaClient, getTransactionRunner } = await import("../db/client.ts");
  const { orgScope } = await import("../db/org-scope.ts");
  const { createInvitation, acceptInvitation } = await import("./invitation.ts");

  const prisma = createPrismaClient();
  const db = prisma as unknown as Parameters<typeof createInvitation>[0];
  const orgId = mkId("a");
  const ownerId = mkId("b");
  const invitedEmail = "invitee@example.test";
  let invitedUserId: string | null = null;

  try {
    await prisma.organization.create({ data: { id: orgId, name: "Организация" } });
    await prisma.user.create({ data: { id: ownerId, email: `${ownerId}@example.test`, name: "Владелец" } });
    await prisma.membership.create({ data: { organizationId: orgId, userId: ownerId, role: "owner" } });

    const { token, invitation } = await createInvitation(db, orgScope(orgId), {
      email: invitedEmail,
      role: "member",
      invitedByUserId: ownerId,
    });
    assert.equal(invitation.organizationId, orgId);
    const stored = await prisma.invitation.findUnique({ where: { id: invitation.id } });
    assert.notEqual(stored?.tokenHash, token, "в БД хранится хеш, а не токен");
    assert.equal(stored?.tokenHash.length, 64, "sha256 в hex");

    const accepted = await acceptInvitation(getTransactionRunner(), token, {
      password: "invitee-pass-1",
      name: "Приглашённый",
    });
    invitedUserId = accepted.userId;

    const membership = await prisma.membership.findFirst({ where: { organizationId: orgId, userId: accepted.userId } });
    assert.equal(membership?.role, "member");
    assert.ok(await prisma.userProfile.findUnique({ where: { userId: accepted.userId } }), "профиль создан");

    const joined = await prisma.auditEvent.findMany({ where: { organizationId: orgId, action: "member.joined" } });
    assert.equal(joined.length, 1, "принятие зафиксировано событием");
    assert.equal(joined[0].actorUserId, accepted.userId);
    assert.equal(joined[0].entityId, accepted.userId);
    const invited = await prisma.auditEvent.findMany({ where: { organizationId: orgId, action: "invitation.created" } });
    assert.equal(invited.length, 1, "создание приглашения зафиксировано");
    assert.equal(invited[0].actorUserId, ownerId);

    await assert.rejects(
      () => acceptInvitation(getTransactionRunner(), token, { password: "invitee-pass-1" }),
      /already|принято|invalid_invitation/,
      "повторное принятие отвергается",
    );
  } finally {
    await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.invitation.deleteMany({ where: { organizationId: orgId } });
    if (invitedUserId) {
      await prisma.userProfile.deleteMany({ where: { userId: invitedUserId } });
      await prisma.session.deleteMany({ where: { userId: invitedUserId } });
    }
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    if (invitedUserId) {
      await prisma.user.deleteMany({ where: { id: invitedUserId } });
    }
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  }
});

test("S2: сброс пароля одноразовый и завершает сессии", { skip }, async () => {
  const { createPrismaClient, getTransactionRunner } = await import("../db/client.ts");
  const { authenticateWithPassword } = await import("./credentials.ts");
  const { createPasswordResetToken, resetPasswordWithToken } = await import("./password-reset.ts");
  const { createSession } = await import("./session.ts");
  const { hashPassword } = await import("./password.ts");

  const prisma = createPrismaClient();
  const db = prisma as unknown as Parameters<typeof authenticateWithPassword>[0];
  const userId = mkId("b");
  const email = `${userId}@example.test`;

  try {
    await prisma.user.create({ data: { id: userId, email, passwordHash: await hashPassword("old-password-1") } });
    await createSession(db, { userId });
    await createSession(db, { userId });

    const issued = await createPasswordResetToken(db, email);
    assert.ok(issued);
    await resetPasswordWithToken(getTransactionRunner(), issued.token, "new-password-1");

    assert.equal(await authenticateWithPassword(db, { email, password: "old-password-1" }), null, "старый пароль не действует");
    assert.equal((await authenticateWithPassword(db, { email, password: "new-password-1" }))?.userId, userId);
    assert.equal(await prisma.session.count({ where: { userId } }), 0, "старые сессии отозваны");
    assert.equal(await prisma.verificationToken.count({ where: { identifier: email } }), 0, "токен одноразовый");

    await assert.rejects(
      () => resetPasswordWithToken(getTransactionRunner(), issued.token, "another-password-1"),
      /invalid_token/,
      "повторное использование токена отвергается",
    );
  } finally {
    await prisma.verificationToken.deleteMany({ where: { identifier: email } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});

test("S2: роли, последний владелец и изоляция организаций", { skip }, async () => {
  const { createPrismaClient } = await import("../db/client.ts");
  const { orgScope } = await import("../db/org-scope.ts");
  const { changeMemberRole, removeMember, requireMembership } = await import("./authorization.ts");

  const prisma = createPrismaClient();
  const db = prisma as unknown as Parameters<typeof requireMembership>[0];
  const org1 = mkId("a");
  const org2 = mkId("b");
  const ownerId = mkId("c");
  const memberId = mkId("d");

  try {
    await prisma.organization.createMany({ data: [{ id: org1, name: "А" }, { id: org2, name: "Б" }] });
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${ownerId}@example.test` },
        { id: memberId, email: `${memberId}@example.test` },
      ],
    });
    await prisma.membership.createMany({
      data: [
        { organizationId: org1, userId: ownerId, role: "owner" },
        { organizationId: org1, userId: memberId, role: "member" },
      ],
    });

    await assert.rejects(
      () => requireMembership(db, memberId, org2),
      /forbidden/,
      "без членства доступ к чужой организации закрыт",
    );

    await assert.rejects(
      () => changeMemberRole(db, orgScope(org1), { actorUserId: memberId, targetUserId: memberId, role: "owner" }),
      /forbidden/,
      "member не может выдавать роли",
    );

    const promoted = await changeMemberRole(db, orgScope(org1), {
      actorUserId: ownerId,
      targetUserId: memberId,
      role: "owner",
    });
    assert.equal(promoted.role, "owner");

    // Теперь в org1 два владельца; понизим одного, затем попробуем удалить последнего.
    await changeMemberRole(db, orgScope(org1), { actorUserId: ownerId, targetUserId: memberId, role: "member" });
    await assert.rejects(
      () => removeMember(db, orgScope(org1), { actorUserId: ownerId, targetUserId: ownerId }),
      /conflict|последнего владельца/,
      "последнего владельца удалить нельзя",
    );

    const roleEvents = await prisma.auditEvent.findMany({
      where: { organizationId: org1, action: "member.role_changed" },
    });
    assert.equal(roleEvents.length, 2, "обе смены роли зафиксированы");
    assert.ok(roleEvents.every((e) => e.actorUserId === ownerId && e.entityId === memberId));
    const transitions = roleEvents
      .map((e) => e.metadata as { from: string; to: string })
      .map((m) => `${m.from}->${m.to}`)
      .sort();
    assert.deepEqual(transitions, ["member->owner", "owner->member"]);
  } finally {
    await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [org1, org2] } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: [org1, org2] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [org1, org2] } } });
    await prisma.$disconnect();
  }
});

test("S2: HTTP-принятие приглашения — setup-flow, одноразовость, срок, изоляция", { skip }, async () => {
  const { createPrismaClient } = await import("../db/client.ts");
  const { orgScope } = await import("../db/org-scope.ts");
  const { createInvitation } = await import("./invitation.ts");
  const { authenticateWithPassword } = await import("./credentials.ts");
  const { hashPassword } = await import("./password.ts");
  const { POST } = await import("../../app/api/auth/invitations/accept/route.ts");

  const prisma = createPrismaClient();
  const db = prisma as unknown as Parameters<typeof createInvitation>[0];
  const orgA = mkId("a");
  const orgB = mkId("b");
  const ownerId = mkId("c");
  const tag = randomBytes(4).toString("hex");
  const invitedEmail = `acc-new-${tag}@example.test`;
  const expiredEmail = `acc-exp-${tag}@example.test`;
  const deletedEmail = `acc-del-${tag}@example.test`;
  const existingEmail = `acc-old-${tag}@example.test`;
  const weakEmail = `acc-weak-${tag}@example.test`;
  const createdUserIds: string[] = [ownerId];

  const accept = (body: unknown) =>
    POST(
      new Request("http://localhost/api/auth/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  try {
    await prisma.organization.createMany({ data: [{ id: orgA, name: "A" }, { id: orgB, name: "B" }] });
    await prisma.user.create({ data: { id: ownerId, email: `owner-${tag}@example.test`, name: "Владелец" } });
    await prisma.membership.create({ data: { organizationId: orgA, userId: ownerId, role: "owner" } });

    // 1-2. Owner создаёт приглашение, получатель принимает его по токену через HTTP.
    const { token } = await createInvitation(db, orgScope(orgA), {
      email: invitedEmail,
      role: "member",
      invitedByUserId: ownerId,
    });
    const res = await accept({ token, password: "setup-pass-1234", name: "Принятый" });
    assert.equal(res.status, 200, "принятие возвращает 200");
    const json = (await res.json()) as { ok: boolean; userId: string; organizationId: string; role: string };
    assert.equal(json.ok, true);
    assert.equal(json.organizationId, orgA, "членство — в организации приглашения");
    assert.equal(json.role, "member", "роль — из приглашения");
    createdUserIds.push(json.userId);

    // 6. Членство создано только в пригласившей организации.
    const membership = await prisma.membership.findFirst({ where: { organizationId: orgA, userId: json.userId } });
    assert.equal(membership?.role, "member");
    assert.equal(await prisma.membership.count({ where: { userId: json.userId } }), 1, "лишних членств нет");
    assert.equal(
      await prisma.membership.findFirst({ where: { organizationId: orgB, userId: json.userId } }),
      null,
      "в чужой организации членство не создаётся",
    );

    // 7-8. Пароль из setup-flow работает для входа.
    const logged = await authenticateWithPassword(db, { email: invitedEmail, password: "setup-pass-1234" });
    assert.equal(logged?.userId, json.userId, "после setup-flow пользователь входит");

    // 4. Повторное использование токена — отказ без побочных эффектов.
    const reuse = await accept({ token, password: "setup-pass-1234" });
    assert.equal(reuse.status, 400, "повтор — 400");
    const reuseText = await reuse.text();
    assert.ok(!reuseText.includes(invitedEmail) && !reuseText.includes(orgA), "ошибка не раскрывает email/организацию");
    assert.equal(await prisma.membership.count({ where: { userId: json.userId } }), 1, "повтор не дублирует членство");

    // 5. Истёкший токен — отказ, пользователь и членство не создаются.
    const expired = await createInvitation(db, orgScope(orgA), {
      email: expiredEmail,
      role: "member",
      invitedByUserId: ownerId,
      ttlMs: -1000,
    });
    const expRes = await accept({ token: expired.token, password: "setup-pass-1234" });
    assert.equal(expRes.status, 400, "истёкший токен — 400");
    const expText = await expRes.text();
    assert.ok(!expText.includes(expiredEmail) && !expText.includes(orgA), "ошибка не раскрывает email/организацию");
    assert.equal(await prisma.user.findFirst({ where: { email: expiredEmail } }), null, "пользователь не создан");

    // 9. Приглашение удалённого пользователя — отказ 409 без мутаций.
    const du = await prisma.user.create({
      data: { email: deletedEmail, passwordHash: await hashPassword("old-pass-1234") },
    });
    createdUserIds.push(du.id);
    await prisma.user.update({ where: { id: du.id }, data: { deletedAt: new Date() } });
    const dinv = await createInvitation(db, orgScope(orgA), {
      email: deletedEmail,
      role: "member",
      invitedByUserId: ownerId,
    });
    const delRes = await accept({ token: dinv.token, password: "setup-pass-1234" });
    assert.equal(delRes.status, 409, "удалённому пользователю — 409");
    const delText = await delRes.text();
    assert.ok(!delText.includes(deletedEmail) && !delText.includes(orgA), "ошибка не раскрывает email/организацию");
    assert.equal(
      await prisma.membership.findFirst({ where: { organizationId: orgA, userId: du.id } }),
      null,
      "удалённому членство не создаётся",
    );

    // Существующий пользователь: приглашение лишь добавляет членство, пароль не перезаписывается.
    const eu = await prisma.user.create({
      data: { email: existingEmail, passwordHash: await hashPassword("existing-pass-1") },
    });
    createdUserIds.push(eu.id);
    const einv = await createInvitation(db, orgScope(orgA), {
      email: existingEmail,
      role: "member",
      invitedByUserId: ownerId,
    });
    const eRes = await accept({ token: einv.token, password: "ignored-new-pass-2" });
    assert.equal(eRes.status, 200);
    assert.equal(((await eRes.json()) as { userId: string }).userId, eu.id, "пользователь не дублируется");
    assert.equal(
      (await authenticateWithPassword(db, { email: existingEmail, password: "existing-pass-1" }))?.userId,
      eu.id,
      "прежний пароль продолжает работать",
    );

    // Слабый пароль отклоняется и не выкупает приглашение.
    const weak = await createInvitation(db, orgScope(orgA), {
      email: weakEmail,
      role: "member",
      invitedByUserId: ownerId,
    });
    assert.equal((await accept({ token: weak.token, password: "short" })).status, 400);
    const weakRes = await accept({ token: weak.token, password: "weak-pass-1234" });
    assert.equal(weakRes.status, 200, "после отказа приглашение остаётся действительным");
    createdUserIds.push(((await weakRes.json()) as { userId: string }).userId);

    const joinedEvents = await prisma.auditEvent.findMany({ where: { organizationId: orgA, action: "member.joined" } });
    assert.equal(joinedEvents.length, 3, "три принятия зафиксированы");
    assert.ok(joinedEvents.every((e) => typeof e.actorUserId === "string" && e.entityId === e.actorUserId));
  } finally {
    await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.invitation.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.userProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.$disconnect();
  }
});

test("S2: обёртка адаптера Auth.js не авторизует мягко удалённого пользователя", { skip }, async () => {
  const { createPrismaClient } = await import("../db/client.ts");
  const { PrismaAdapter } = await import("@auth/prisma-adapter");
  const { withRevokedSessionsForDeletedUsers } = await import("./adapter.ts");

  const prisma = createPrismaClient();
  const userId = mkId("c");
  const email = `${userId}@example.test`;
  const token = `tok-${userId}`;

  try {
    await prisma.user.create({ data: { id: userId, email } });
    await prisma.session.create({
      data: { sessionToken: token, userId, expires: new Date(Date.now() + 3600_000) },
    });

    const adapter = withRevokedSessionsForDeletedUsers(PrismaAdapter(prisma));

    const active = await adapter.getSessionAndUser?.(token);
    assert.ok(active, "активный пользователь авторизуется через адаптер (A, E)");
    assert.equal(active.user.id, userId);
    assert.equal(await prisma.session.count({ where: { userId } }), 1, "строка активной сессии цела");

    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    assert.equal(
      await adapter.getSessionAndUser?.(token),
      null,
      "сессия удалённого пользователя недействительна (B)",
    );
    assert.equal(await prisma.session.count({ where: { userId } }), 0, "строка сессии подчинена");

    assert.equal(await adapter.getSessionAndUser?.(`tok-missing-${userId}`), null, "неизвестный токен — null");
  } finally {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
