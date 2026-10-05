/**
 * S11-R0: серверный выбор организации из подтверждённых членств.
 *
 * Заголовок — запрос выбора, а не источник истины: право подтверждает только
 * `Membership`. Чужой/неизвестный organizationId не проходит; при нескольких
 * членствах без выбора — отказа; при одном членстве выбор необязателен.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { requestedOrganizationId, selectMembership } from "./route.ts";

const A = { organizationId: "org-a" };
const B = { organizationId: "org-b" };

test("selectMembership: одно членство — выбор необязателен", () => {
  assert.equal(selectMembership([A], null)?.organizationId, "org-a");
});

test("selectMembership: несколько членств без запроса — отказ", () => {
  assert.equal(selectMembership([A, B], null), null);
});

test("selectMembership: явный выбор подтверждается членством", () => {
  assert.equal(selectMembership([A, B], "org-b")?.organizationId, "org-b");
});

test("selectMembership: чужой/неизвестный organizationId не проходит", () => {
  assert.equal(selectMembership([A], "org-b"), null, "чужая организация");
  assert.equal(selectMembership([], "org-a"), null, "нет членств");
});

test("requestedOrganizationId: читает только заголовок и валидирует длину", () => {
  assert.equal(requestedOrganizationId(new Request("http://x", { headers: { "x-organization-id": " org-a " } })), "org-a");
  assert.equal(requestedOrganizationId(new Request("http://x")), null);
  assert.equal(requestedOrganizationId(new Request("http://x", { headers: { "x-organization-id": "x".repeat(100) } })), null);
  assert.equal(
    requestedOrganizationId(new Request("http://x?organizationId=org-b")),
    null,
    "query-параметр не является источником выбора",
  );
});
