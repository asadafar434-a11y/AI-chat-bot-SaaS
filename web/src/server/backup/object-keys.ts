/**
 * Единственный источник SQL для перечисления ключей объектов S6, на которые
 * ссылается БД (S9, расширено в S11-R0).
 *
 * Раньше учитывался только `Document.storageKey`. После S11-R0 в хранилище
 * лежат ещё текст и карта документов, а также текст и карта образцов: без них
 * backup считал бы новые объекты сиротами, а restore не заметил бы их потерю.
 */

/** Пары «таблица.колонка», откуда берутся ключи объектов. */
export const OBJECT_KEY_COLUMNS = [
  "Document.storageKey",
  "Document.textKey",
  "Document.mapKey",
  "Sample.textKey",
  "Sample.mapKey",
] as const;

/** UNION-запрос: по одному ключу на строку, дубли не важны. */
export const OBJECT_KEYS_SQL = `
SELECT "storageKey" AS key FROM "Document" WHERE "storageKey" IS NOT NULL
UNION SELECT "textKey" FROM "Document" WHERE "textKey" IS NOT NULL
UNION SELECT "mapKey" FROM "Document" WHERE "mapKey" IS NOT NULL
UNION SELECT "textKey" FROM "Sample" WHERE "textKey" IS NOT NULL
UNION SELECT "mapKey" FROM "Sample" WHERE "mapKey" IS NOT NULL`;
