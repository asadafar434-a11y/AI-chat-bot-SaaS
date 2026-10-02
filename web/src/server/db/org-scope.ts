/**
 * Обязательный скоуп организации для любого доступа к данным арендатора.
 *
 * Зачем это отдельный модуль: изоляция, обеспеченная только соглашением («remember to
 * pass organizationId»), нарушается один раз и молча. Здесь скоуп — это значение,
 * которое нельзя построить из воздуха и которое репозиторий накладывает на условие
 * выборки сам, а не получает от вызывающего кода готовым `where`.
 *
 * Правило: `organizationId` никогда не приходит из тела запроса, query-параметра или
 * заголовка. Он берётся из серверней сессии (этап S2) и оформляется в `OrgScope`.
 */

import { InvalidArgumentError, MissingOrganizationScopeError } from "./errors.ts";

/** Скоуп доступа к данным одной организации. */
export type OrgScope = {
  readonly organizationId: string;
};

const ORG_ID_PATTERN = /^c[a-z0-9]{20,24}$/;

/**
 * Создаёт скоуп из идентификатора организации.
 *
 * Проверка формата намеренно строгая: идентификаторы выдаёт сервер (`cuid()`), поэтому
 * значение другого вида — это ошибка или подмена, и проходить дальше оно не должно.
 */
export function orgScope(organizationId: string): OrgScope {
  if (typeof organizationId !== "string" || !ORG_ID_PATTERN.test(organizationId)) {
    throw new InvalidArgumentError(
      `organizationId должен быть непустой строкой вида cuid(), получено: ${JSON.stringify(organizationId)}`,
    );
  }
  return Object.freeze({ organizationId });
}

/** Возвращает `organizationId` скоупа или бросает программную ошибку. */
export function requireOrgId(scope: OrgScope | null | undefined, operation: string): string {
  if (!scope || typeof scope.organizationId !== "string" || !ORG_ID_PATTERN.test(scope.organizationId)) {
    throw new MissingOrganizationScopeError(operation);
  }
  return scope.organizationId;
}

/** Является ли значение корректным скоупом. Удобно для проверок на границе сервиса. */
export function isOrgScope(value: unknown): value is OrgScope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { organizationId?: unknown }).organizationId === "string" &&
    ORG_ID_PATTERN.test((value as { organizationId: string }).organizationId)
  );
}

export type QueryArgs = Record<string, unknown>;

/**
 * Накладывает скоуп на условие выборки.
 *
 * Три свойства, ради которых функция существует:
 *
 * 1. `organizationId` попадает в условие **всегда**, если скоуп передан;
 * 2. скоуп без валидного `organizationId` — программная ошибка, а не «фильтр не применился»;
 * 3. чужой `organizationId` из `where` вызывающего не может перекрыть скоуп — попытка
 *    подмены приводит к отказу, а не к тихой смене адресата запроса.
 *
 * Условие читается в одном SQL-выражении вместе с выборкой. Проверка «сначала прочитали,
 * потом сравнили» здесь невозможна by construction.
 */
export function withOrgScope(
  where: QueryArgs | undefined,
  scope: OrgScope | null | undefined,
  operation: string,
): QueryArgs {
  const organizationId = requireOrgId(scope, operation);

  if (where && Object.hasOwn(where, "organizationId") && where.organizationId !== organizationId) {
    throw new InvalidArgumentError(
      `${operation} — попытка переопределить organizationId в where; скоуп ${organizationId} не может быть подменён на ${JSON.stringify(where.organizationId)}`,
    );
  }

  return { ...(where ?? {}), organizationId };
}

/**
 * Накладывает скоуп на `data` при записи: `organizationId` выставляется скоупом, а
 * переданное вызывающим значение отбрасывается.
 *
 * Нужно для импорта и для кодов, которые формируют объект записи целиком: скоуп здесь —
 * единственный источник адресата.
 */
export function withOrgScopeData<T extends QueryArgs>(
  data: T,
  scope: OrgScope | null | undefined,
  operation: string,
): Omit<T, "organizationId"> & { organizationId: string } {
  const organizationId = requireOrgId(scope, operation);
  const { organizationId: _ignored, ...rest } = data as QueryArgs;
  return { ...rest, organizationId } as Omit<T, "organizationId"> & { organizationId: string };
}

/**
 * Запрещает менять `organizationId` через данные мутации.
 *
 * Создание форсирует организацию скоупом (`withOrgScopeData`), а любое изменение —
 * только отклоняет: запись нельзя переместить между организациями через обновление.
 * Проверка строгая: отклоняется даже значение, совпадающее со скоупом. Причина —
 * однозначность: поле `organizationId` в `data` обновления всегда означает попытку
 * сменить владельца, а молчаливое игнорирование скрывало бы баг вызывающего кода.
 */
export function rejectOrgOverride(data: QueryArgs | undefined, operation: string): void {
  if (data && Object.hasOwn(data, "organizationId")) {
    throw new InvalidArgumentError(
      `${operation} — изменение organizationId запрещено; запись нельзя переместить между организациями через обновление`,
    );
  }
}
