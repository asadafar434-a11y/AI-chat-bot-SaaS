// Реквизиты участника: вписываются один раз и подставляются в анкету, декларацию, цену и подпись.
// В техническое предложение они не попадают никогда: его подают в первую часть заявки, анонимно.
export type Profile = {
  fullName: string;
  shortName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  okved: string;
  smeCategory: string;
  taxSystem: string;
  vatNote: string;
  legalAddress: string;
  postalAddress: string;
  account: string;
  bankName: string;
  bik: string;
  corrAccount: string;
  head: string;
  signer: string;
  contactPerson: string;
  phone: string;
  email: string;
};

export type ProfileKey = keyof Profile;

type Field = { key: ProfileKey; label: string; example?: string };

export const PROFILE_GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: "Участник",
    fields: [
      { key: "fullName", label: "Полное наименование (для ИП — фамилия, имя, отчество)" },
      { key: "shortName", label: "Сокращённое наименование" },
      { key: "inn", label: "ИНН" },
      { key: "kpp", label: "КПП (для юридического лица)" },
      { key: "ogrn", label: "ОГРН / ОГРНИП" },
      { key: "okved", label: "Основной вид деятельности по ОКВЭД", example: "например, 90.01" },
      { key: "smeCategory", label: "Категория субъекта МСП", example: "микропредприятие, малое или среднее предприятие" },
    ],
  },
  {
    title: "Налоги",
    fields: [
      { key: "taxSystem", label: "Система налогообложения", example: "например, УСН" },
      { key: "vatNote", label: "Как писать НДС в цене", example: "например, «НДС не облагается в связи с применением УСН»" },
    ],
  },
  {
    title: "Адреса",
    fields: [
      { key: "legalAddress", label: "Юридический адрес (для ИП — адрес регистрации)" },
      { key: "postalAddress", label: "Почтовый адрес" },
    ],
  },
  {
    title: "Банк",
    fields: [
      { key: "account", label: "Расчётный счёт" },
      { key: "bankName", label: "Наименование банка" },
      { key: "bik", label: "БИК" },
      { key: "corrAccount", label: "Корреспондентский счёт" },
    ],
  },
  {
    title: "Руководитель и контакты",
    fields: [
      { key: "head", label: "Руководитель: должность, ФИО, на каком основании действует" },
      { key: "signer", label: "Расшифровка подписи", example: "например, «Иванова А. П.»" },
      { key: "contactPerson", label: "Контактное лицо" },
      { key: "phone", label: "Телефон" },
      { key: "email", label: "Адрес электронной почты" },
    ],
  },
];

export const PROFILE_KEYS = PROFILE_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

export const EMPTY_PROFILE = Object.fromEntries(PROFILE_KEYS.map((key) => [key, ""])) as Profile;

// Строки анкеты участника по порядку; каждая берёт значение из реквизитов.
export const ANKETA: { key: ProfileKey; label: string }[] = [
  { key: "fullName", label: "Полное наименование (для ИП — фамилия, имя, отчество)" },
  { key: "shortName", label: "Сокращённое наименование" },
  { key: "inn", label: "ИНН" },
  { key: "kpp", label: "КПП (для юридического лица)" },
  { key: "ogrn", label: "ОГРН / ОГРНИП" },
  { key: "legalAddress", label: "Юридический адрес (для ИП — адрес регистрации по месту жительства)" },
  { key: "postalAddress", label: "Почтовый адрес" },
  { key: "okved", label: "Основной вид деятельности по ОКВЭД" },
  { key: "taxSystem", label: "Система налогообложения" },
  { key: "account", label: "Расчётный счёт" },
  { key: "bankName", label: "Наименование банка" },
  { key: "bik", label: "БИК" },
  { key: "corrAccount", label: "Корреспондентский счёт" },
  { key: "head", label: "Руководитель (должность, ФИО), действует на основании" },
  { key: "contactPerson", label: "Контактное лицо" },
  { key: "phone", label: "Телефон" },
  { key: "email", label: "Адрес электронной почты" },
  { key: "smeCategory", label: "Категория субъекта МСП" },
];

// Поля «[…]» в текстах формы заказчика, которые можно заполнить реквизитами. Порядок важен:
// «[должность, фамилия, имя, отчество руководителя]» — это руководитель, а не наименование.
const FIELD_RULES: [RegExp, ProfileKey][] = [
  [/должност|руководител/i, "head"],
  [/категори/i, "smeCategory"],
  [/наименовани|фамилия, имя, отчество/i, "fullName"],
];

export function fillFromProfile(text: string, profile: Profile | null): string {
  if (!profile) return text;
  return text.replace(/\[([^\]]+)\]/g, (field, hint: string) => {
    const rule = FIELD_RULES.find(([re]) => re.test(hint));
    return (rule && profile[rule[1]].trim()) || field;
  });
}

export const filledCount = (profile: Profile) => PROFILE_KEYS.filter((key) => profile[key].trim()).length;

// То, по чему комиссия узнает участника. Если что-то из этого есть в ТП, заявку отклонят.
export function identityValues(profile: Profile): string[] {
  const surname = profile.signer.trim().split(/\s+/)[0] ?? "";
  return [profile.fullName, profile.shortName, profile.inn, profile.ogrn, profile.kpp, profile.phone, profile.email, profile.account, surname]
    .map((value) => value.trim())
    .filter((value) => value.length >= 4);
}
