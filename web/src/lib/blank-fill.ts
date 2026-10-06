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
  { key: "legalAddress", match: /юридическ\S* адрес|место нахождения|адрес регистрации|место жительства/ },
  { key: "postalAddress", match: /почтов\S* адрес/ },
  { key: "bik", match: /бик/ },
  { key: "corrAccount", match: /корреспондентск|^к\/с/ },
  { key: "account", match: /расч[её]тн\S* сч[её]т|^р\/с/ },
  { key: "bankName", match: /банк/, not: /сч[её]т|бик|корр|реквизит|гарант/ },
  { key: "head", match: /руководител/ },
  { key: "smeCategory", match: /категори/ },
  { key: "phone", match: /телефон/ },
  { key: "email", match: /e-?mail|электронн\S* почт/ },
];

const valueOf = (label: string, profile: Profile) => {
  const text = label.toLowerCase().replace(/\s+/g, " ").trim();
  const rule = RULES.find((r) => r.match.test(text) && !r.not?.test(text));
  return rule ? profile[rule.key].trim() : "";
};

// Бланк технического предложения анонимный: реквизиты в него не попадают.
export function fillBlank(df: DetectedForm, profile: Profile | null): DetectedForm {
  if (!profile || /техническ|технико-коммерч/i.test(df.title)) return df;
  return { ...df, fields: df.fields.map((f) => ({ ...f, value: f.value.trim() || valueOf(f.label, profile) })) };
}
