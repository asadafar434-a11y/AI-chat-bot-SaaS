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

// help — подсказка «?» у поля: что это и где взять.
type Field = { key: ProfileKey; label: string; example?: string; help?: string };

export const PROFILE_GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: "Участник",
    fields: [
      { key: "fullName", label: "Полное наименование (для ИП — фамилия, имя, отчество)" },
      { key: "shortName", label: "Сокращённое наименование" },
      { key: "inn", label: "ИНН" },
      { key: "kpp", label: "КПП (для юридического лица)", help: "Код причины постановки на учёт — 9 знаков, есть в выписке из ЕГРЮЛ. Бывает только у организаций, у ИП его нет." },
      { key: "ogrn", label: "ОГРН / ОГРНИП", help: "Основной государственный регистрационный номер: у организации — ОГРН из 13 цифр, у ИП — ОГРНИП из 15. Есть в выписке из ЕГРЮЛ или ЕГРИП." },
      { key: "okved", label: "Основной вид деятельности по ОКВЭД", example: "например, 90.01", help: "Код основного вида деятельности из выписки ЕГРЮЛ или ЕГРИП. Например, 90.01 — деятельность в области исполнительских искусств." },
      { key: "smeCategory", label: "Категория субъекта МСП", example: "микропредприятие, малое или среднее предприятие", help: "Микропредприятие, малое или среднее предприятие — как в едином реестре субъектов МСП на сайте ФНС (rmsp.nalog.ru). Нужна для декларации о принадлежности к МСП." },
    ],
  },
  {
    title: "Налоги",
    fields: [
      { key: "taxSystem", label: "Система налогообложения", example: "например, УСН", help: "Например, УСН или ОСН — от неё зависит, как писать НДС в цене." },
      { key: "vatNote", label: "Как писать НДС в цене", example: "например, «НДС не облагается в связи с применением УСН»", help: "Фраза для предложения о цене. На УСН — «НДС не облагается в связи с применением УСН»; если платите НДС — «в том числе НДС» и сумма." },
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
      { key: "account", label: "Расчётный счёт", help: "Ваш счёт в банке — 20 цифр. У организаций обычно начинается с 407, у ИП — с 408." },
      { key: "bankName", label: "Наименование банка" },
      { key: "bik", label: "БИК", help: "Банковский идентификационный код — 9 цифр, есть в реквизитах банка." },
      { key: "corrAccount", label: "Корреспондентский счёт", help: "Счёт вашего банка в Банке России — 20 цифр, начинается с 301. Есть в реквизитах банка." },
    ],
  },
  {
    title: "Руководитель и контакты",
    fields: [
      { key: "head", label: "Руководитель: должность, ФИО, на каком основании действует", help: "Как в анкете: должность, фамилия, имя, отчество и основание полномочий. Например: «Генеральный директор Иванова Анна Петровна, действует на основании Устава»." },
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
