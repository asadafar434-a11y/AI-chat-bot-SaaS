/**
 * Ошибки persistence-слоя.
 *
 * Ошибки различают две вещи: «запрос не выполнен, потому что не передан скоуп» — это
 * программная ошибка вызывающего кода; «запись не найдена в этой организации» — это
 * штатный отрицательный результат.
 *
 * Второй случай намеренно не различает «не существует» и «существует, но принадлежит
 * другой организации»: иначе по различию ответов можно перебором выяснить, какие
 * идентификаторы существуют в чужом арендаторе.
 */

/** Запрос к организации-скоупленной таблице выполнен без скоупа. Это баг в коде. */
export class MissingOrganizationScopeError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(
      `MissingOrganizationScopeError: ${operation} — запрос к организации-скоупленной таблице без organizationId`,
    );
    this.name = "MissingOrganizationScopeError";
    this.operation = operation;
  }
}

/**
 * Запись не найдена в пределах организации — либо её нет, либо она принадлежит другой
 * организации. Оба случая намеренно дают один и тот же отказ.
 */
export class NotFoundInScopeError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`NotFoundInScopeError: ${operation} — запись не найдена в пределах организации`);
    this.name = "NotFoundInScopeError";
    this.operation = operation;
  }
}

/** Значение, обязательное для запроса, не заполнено. */
export class InvalidArgumentError extends Error {
  constructor(message: string) {
    super(`InvalidArgumentError: ${message}`);
    this.name = "InvalidArgumentError";
  }
}
