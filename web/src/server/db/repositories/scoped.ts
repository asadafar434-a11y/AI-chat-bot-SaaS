/**
 * Общие операции репозиториев: чтение, изменение и удаление с обязательным скоупом.
 *
 * Почему изменение и удаление идут через `updateMany`/`deleteMany`, а не через
 * `update`/`delete`:
 *
 * - `update` и `delete` в Prisma требуют `where` с уникальным полем, а условие
 *   `{ id, organizationId }` уникальным не является;
 * - обходной путь «сначала прочитали, потом сравнили id» — это ровно тот порядок,
 *   который запрещён контрактом: между чтением и изменением есть окно, а по различию
 *   ответов можно выяснить, существует ли чужая запись;
 * - `updateMany`/`deleteMany` принимают произвольное условие и выполняют его **в одном
 *   SQL-выражении** вместе с самой мутацией. Скоуп не может быть «забыт», потому что он
 *   является частью того же выражения.
 *
 * Нулевой `count` означает «не найдено в этой организации» и приводит к
 * `NotFoundInScopeError` — одинаковому ответу для отсутствующей и для чужой записи.
 */

import type { DbClient, QueryArgs } from "../db-client.ts";
import { NotFoundInScopeError } from "../errors.ts";
import type { OrgScope } from "../org-scope.ts";
import { rejectOrgOverride, requireOrgId, withOrgScope, withOrgScopeData } from "../org-scope.ts";

/**
 * Набор скоупленных операций над одной организацией-скоупленной моделью.
 *
 * Мягкого удаления здесь нет сознательно: ни одна таблица, обслуживаемая generic-фабрикой,
 * не имеет колонки `deletedAt`. Мягкое удаление доступно только там, где колонка реально
 * существует — для организации через `organizationRepository().softRemove`
 * (см. `repositories/index.ts`).
 */
export type ScopedRepo<T> = {
  /** Префикс операций для сообщений об ошибках, например `purchase.update`. */
  readonly operation: string;
  /** Организация, к которой привязан этот набор операций. */
  readonly organizationId: string;
  list(args?: QueryArgs): Promise<T[]>;
  getById(id: string): Promise<T | null>;
  count(args?: QueryArgs): Promise<number>;
  create(data: QueryArgs): Promise<T>;
  update(id: string, data: QueryArgs): Promise<T>;
  remove(id: string): Promise<number>;
};

/**
 * Создаёт скоупленный набор операций над делегатом `delegateName`.
 *
 * Скоуп привязывается при создании набора, а не передаётся в каждый вызов: так нельзя
 * случайно выполнить операцию без него, потому что взять её неоткуда.
 */
export function scopedRepository<T = unknown>(
  db: DbClient,
  delegateName: keyof DbClient,
  scope: OrgScope,
  operationPrefix: string,
): ScopedRepo<T> {
  const delegate = db[delegateName];
  const organizationId = requireOrgId(scope, `${operationPrefix}.bind`);
  const op = (suffix: string) => `${operationPrefix}.${suffix}`;

  const list = async (args?: QueryArgs): Promise<T[]> =>
    (await delegate.findMany({
      ...args,
      where: withOrgScope(args?.where as QueryArgs | undefined, scope, op("list")),
    })) as T[];

  const getById = async (id: string): Promise<T | null> =>
    (await delegate.findFirst({ where: withOrgScope({ id }, scope, op("getById")) })) as T | null;

  const count = (args?: QueryArgs) =>
    delegate.count({
      ...args,
      where: withOrgScope(args?.where as QueryArgs | undefined, scope, op("count")),
    });

  const create = async (data: QueryArgs): Promise<T> =>
    (await delegate.create({ data: withOrgScopeData(data, scope, op("create")) })) as T;

  const update = async (id: string, data: QueryArgs): Promise<T> => {
    // Организация записи неизменна: смена organizationId через update отклоняется
    // до обращения к БД, а не после.
    rejectOrgOverride(data, op("update"));
    const result = await delegate.updateMany({
      where: withOrgScope({ id }, scope, op("update")),
      data,
    });
    if (result.count === 0) {
      throw new NotFoundInScopeError(op("update"));
    }
    return (await delegate.findFirst({
      where: withOrgScope({ id }, scope, op("update.readback")),
    })) as T;
  };

  const remove = async (id: string): Promise<number> => {
    const result = await delegate.deleteMany({
      where: withOrgScope({ id }, scope, op("remove")),
    });
    if (result.count === 0) {
      throw new NotFoundInScopeError(op("remove"));
    }
    return result.count;
  };

  return { operation: operationPrefix, organizationId, list, getById, count, create, update, remove };
}
