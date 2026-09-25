// Правовые страницы: политика обработки персональных данных, согласие, условия и контакты владельца.
// Открыты всем, даже на закрытой ссылке: политику закон требует держать в открытом доступе
// (ч. 2 ст. 18.1 152-ФЗ), сведения о владельце сайта — тоже (ч. 2 ст. 10 149-ФЗ).
export const LEGAL_PAGES = [
  { href: "/privacy", title: "Политика обработки персональных данных", short: "Политика" },
  { href: "/consent", title: "Согласие на обработку персональных данных", short: "Согласие" },
  { href: "/terms", title: "Условия использования", short: "Условия" },
  { href: "/contacts", title: "Контакты", short: "Контакты" },
] as const;

export const isLegalPath = (pathname: string) => LEGAL_PAGES.some((page) => page.href === pathname);

// Дата текущей редакции текстов. Поменяли текст — поменяйте и дату.
export const LEGAL_EDITION = "25 сентября 2026 г.";

// Владелец сервиса и оператор персональных данных. Задаются на хостинге, как ключ API; страницы читают их
// при каждом открытии, так что после смены пересобирать приложение не нужно.
const OPERATOR_FIELDS = {
  name: { env: "OPERATOR_NAME", empty: "наименование ИП или организации" },
  inn: { env: "OPERATOR_INN", empty: "ИНН" },
  ogrn: { env: "OPERATOR_OGRN", empty: "ОГРН или ОГРНИП" },
  address: { env: "OPERATOR_ADDRESS", empty: "адрес" },
  email: { env: "OPERATOR_EMAIL", empty: "электронная почта" },
} as const;

export type OperatorKey = keyof typeof OPERATOR_FIELDS;
export type OperatorValue = { value: string; empty: string };
export type Operator = Record<OperatorKey, OperatorValue> & { missing: string[] };

export function readOperator(): Operator {
  const fields = Object.fromEntries(
    Object.entries(OPERATOR_FIELDS).map(([key, { env, empty }]) => [key, { value: (process.env[env] ?? "").trim(), empty }])
  ) as Record<OperatorKey, OperatorValue>;
  const missing = Object.values(OPERATOR_FIELDS)
    .filter(({ env }) => !(process.env[env] ?? "").trim())
    .map(({ env }) => env);
  return { ...fields, missing };
}
