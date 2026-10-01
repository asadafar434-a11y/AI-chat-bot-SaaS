// Короткий отпечаток данных: по нему видно, что часть заявки составлена из тех же реквизитов, цены и образцов, а проверка
// сделана по тем же документам закупки. Модуль без зависимостей: его проверяют тесты (npm test).
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = (hash * 33 + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
