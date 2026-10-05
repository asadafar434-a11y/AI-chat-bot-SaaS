import assert from "node:assert/strict";
import test from "node:test";

import { InvalidArgumentError, MissingOrganizationScopeError } from "./errors.ts";
import { isOrgScope, orgScope, requireOrgId, withOrgScope, withOrgScopeData } from "./org-scope.ts";

const ORG_A = "ckq2h1x9a0b3c4d5e6f7g8";
const ORG_B = "ckq2h1x9a0b3c4d5e6f7h9";
const ORG_A_ORG_B = `${ORG_A}-${ORG_B}`;

test("orgScope принимает cuid-подобный идентификатор", () => {
  const scope = orgScope(ORG_A);
  assert.equal(scope.organizationId, ORG_A);
  assert.ok(isOrgScope(scope));
});

test("orgScope отклоняет пустое значение и значения чужого вида", () => {
  assert.throws(() => orgScope(""), InvalidArgumentError);
  assert.throws(() => orgScope("   "), InvalidArgumentError);
  assert.throws(() => orgScope("../../etc/passwd"), InvalidArgumentError);
  assert.throws(() => orgScope("' OR '1'='1"), InvalidArgumentError);
  assert.throws(() => orgScope(ORG_A_ORG_B), InvalidArgumentError);
  assert.throws(() => orgScope(null as unknown as string), InvalidArgumentError);
  assert.throws(() => orgScope(42 as unknown as string), InvalidArgumentError);
});

test("isOrgScope отличает скоуп от похожих объектов", () => {
  assert.equal(isOrgScope(null), false);
  assert.equal(isOrgScope(undefined), false);
  assert.equal(isOrgScope("organization"), false);
  assert.equal(isOrgScope({}), false);
  assert.equal(isOrgScope({ organizationId: 1 }), false);
  assert.equal(isOrgScope({ organizationId: ORG_A }), true);
  assert.equal(isOrgScope({ organizationId: ORG_A, extra: "ignored" }), true);
});

test("requireOrgId возвращает идентификатор или бросает программную ошибку", () => {
  assert.equal(requireOrgId(orgScope(ORG_A), "op"), ORG_A);
  assert.throws(() => requireOrgId(null, "op"), MissingOrganizationScopeError);
  assert.throws(() => requireOrgId(undefined, "op"), MissingOrganizationScopeError);
  assert.throws(() => requireOrgId({ organizationId: "" } as never, "op"), MissingOrganizationScopeError);
});

test("requireOrgId сообщает имя операции в тексте ошибки", () => {
  assert.throws(() => requireOrgId(null, "purchase.update"), /purchase\.update/);
});

test("withOrgScope добавляет organizationId к пустому условию", () => {
  assert.deepEqual(withOrgScope(undefined, orgScope(ORG_A), "op"), { organizationId: ORG_A });
});

test("withOrgScope добавляет organizationId к существующему условию", () => {
  const where = { id: "some-id", status: "draft" };
  const result = withOrgScope(where, orgScope(ORG_A), "op");
  assert.deepEqual(result, { id: "some-id", status: "draft", organizationId: ORG_A });
});

test("withOrgScope не изменяет переданный объект условия", () => {
  const where = { id: "some-id" };
  withOrgScope(where, orgScope(ORG_A), "op");
  assert.deepEqual(where, { id: "some-id" });
});

test("withOrgScope не позволяет подменить организацию чужим значением", () => {
  assert.throws(() => withOrgScope({ organizationId: ORG_B }, orgScope(ORG_A), "op"), InvalidArgumentError);
});

test("withOrgScope допускает повтор того же значения и не затирает прочие условия", () => {
  const result = withOrgScope({ organizationId: ORG_A, deletedAt: null }, orgScope(ORG_A), "op");
  assert.deepEqual(result, { organizationId: ORG_A, deletedAt: null });
});

test("withOrgScope без скоупа — программная ошибка, а не запрос без фильтра", () => {
  assert.throws(() => withOrgScope({ id: "x" }, null, "op"), MissingOrganizationScopeError);
  assert.throws(() => withOrgScope(undefined, undefined, "op"), MissingOrganizationScopeError);
});

test("withOrgScopeData проставляет организацию из скоупа", () => {
  const result = withOrgScopeData({ payload: { a: 1 } }, orgScope(ORG_A), "op");
  assert.deepEqual(result, { payload: { a: 1 }, organizationId: ORG_A });
});

test("withOrgScopeData отбрасывает чужую организацию, переданную в данных", () => {
  const result = withOrgScopeData({ organizationId: ORG_B, name: "Закупка" }, orgScope(ORG_A), "op");
  assert.deepEqual(result, { name: "Закупка", organizationId: ORG_A });
});

test("withOrgScopeData не требует organizationId в данных", () => {
  assert.throws(() => withOrgScopeData({ name: "x" }, null, "op"), MissingOrganizationScopeError);
});

test("организация из скоупа не может быть переписана вложенным объектом условия", () => {
  // Попытка вынести фильтр в AND-ветку не должна оставлять запрос без верхнего фильтра.
  const result = withOrgScope({ AND: [{ organizationId: ORG_B }] }, orgScope(ORG_A), "op");
  assert.equal(result.organizationId, ORG_A);
});
