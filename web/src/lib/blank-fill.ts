import type { Profile } from "@/lib/profile";
import type { DetectedForm } from "@/lib/tp";

// Строка бланка узнаётся по названию; порядок важен: сокращённое раньше полного, банк раньше наименования.
const RULES: { key: keyof Profile; match: RegExp; not?: RegExp }[] = [
  { key: "shortName", match: /сокращ/ },
  { key: "fullName", match: /наименовани|фамилия, имя, отчество/, not: /сокращ|банк|товар|услуг|работ|объект|адрес|страна|учредител|производ|дилер/ },
  { key: "inn", match: /(^|[ (])инн($|[ )])/, not: /учредител|контрагент|производ|поставщ/ },
  { key: "kpp", match: /кпп/ },
  { key: "ogrn", match: /огрн/ },
  { key: "okved", match: /окв[её]д/ },
  { key: "taxSystem", match: /налогообложени/ },
  { key: "legalAddress", match: /юридическ\S* адрес|мест[оа] нахождения|адрес регистрации|место жительства/ },
  { key: "postalAddress", match: /почтов\S* адрес/ },
  { key: "bik", match: /бик/ },
  { key: "corrAccount", match: /корреспондентск|^к\/с/ },
  { key: "account", match: /расч[её]тн\S* сч[её]т|^р\/с/ },
  { key: "bankName", match: /банк/, not: /сч[её]т|бик|корр|реквизит|гарант/ },
  { key: "contactPerson", match: /ответственн\S* лиц|контактн\S* лиц/ },
  { key: "head", match: /руководител/ },
  { key: "smeCategory", match: /категори/ },
  { key: "phone", match: /телефон/ },
  { key: "email", match: /e-?mail|электронн\S* почт/ },
];

const normalize = (label: string) => label.toLowerCase().replace(/\s+/g, " ").trim();

// «Банковские реквизиты (наименование и адрес банка, номер расчётного счёта…)» — одной строкой всё, что известно о банке.
const bankLine = (profile: Profile) =>
  [profile.bankName.trim(), profile.account.trim() && `р/с ${profile.account.trim()}`, profile.bik.trim() && `БИК ${profile.bik.trim()}`, profile.corrAccount.trim() && `к/с ${profile.corrAccount.trim()}`]
    .filter(Boolean)
    .join(", ");

/** Что из реквизитов участника стоит напротив строки бланка с таким названием; пусто — это не реквизит или реквизита нет. */
export const profileValueOf = (label: string, profile: Profile): string => {
  const text = normalize(label);
  if (/банковск\S* реквизит/.test(text)) return bankLine(profile);
  const rule = RULES.find((r) => r.match.test(text) && !r.not?.test(text));
  return rule ? profile[rule.key].trim() : "";
};

// Бланк технического предложения анонимный: реквизиты в него не попадают.
export function fillBlank(df: DetectedForm, profile: Profile | null): DetectedForm {
  if (!profile || /техническ|технико-коммерч/i.test(df.title)) return df;
  return { ...df, fields: df.fields.map((f) => ({ ...f, value: f.value.trim() || profileValueOf(f.label, profile) })) };
}
