// Общие данные для тестов файлов заявки: Word, PDF и ODT собираются из одного описания документа (tp-doc-model.ts),
// поэтому и проверяются на одних и тех же данных. В самом приложении этот файл не используется.
import type { PartDoc } from "./part-doc.ts";
import { EMPTY_PROFILE, type Profile } from "./profile.ts";
import { PLAIN_FORM } from "./tp.ts";
import type { TpDocx } from "./tp-doc-model.ts";
import { PART_TITLES, type TpPart } from "./tp-parts.ts";

export const PROFILE: Profile = {
  ...EMPTY_PROFILE,
  fullName: "Общество с ограниченной ответственностью «Ромашка»",
  shortName: "ООО «Ромашка»",
  inn: "6612345676",
  kpp: "661201001",
  ogrn: "1146612000127",
  account: "40702810916540001234",
  phone: "+7 912 000-00-00",
  email: "romashka@example.ru",
  head: "Генеральный директор Иванова Анна Петровна, действует на основании Устава",
  signer: "Иванова А. П.",
  vatNote: "НДС не облагается в связи с применением УСН",
  smeCategory: "микропредприятие",
};

// Полный набор: товары, пункты ТЗ, состав исполнителей, цена, жёлтые места и строка анкеты заказчика.
export const DATA: TpDocx = {
  subject: "Организация церемонии «Педагог года»",
  form: {
    ...PLAIN_FORM,
    hasPrice: true,
    consent: "Изучив документацию, [наименование участника] согласен поставить товар.\nВторая строка согласия.",
    priceNote: "Цена включает все расходы.",
    smeDeclaration: "[наименование участника] относится к субъектам МСП: [категория].",
    participantFields: ["Контактное лицо по договору"],
  },
  goods: [
    { name: "Моноблок 23,8″", characteristics: "Процессор Intel Core i5\nОЗУ [объём] ГБ", quantity: "32 шт." },
    { name: "МФУ лазерное", characteristics: "Скорость печати не менее [скорость] стр/мин", quantity: "12 шт." },
  ],
  items: [
    { clause: "2.1", requirement: "Зал не менее 150 мест", offer: "Зал на [число, не меньше 150] мест, гардероб." },
    { clause: "", requirement: "Ведущий с опытом", offer: "Ведущий — опыт 7 лет." },
  ],
  cast: {
    clause: "3.5",
    rows: [
      { who: "Вокалист", name: "Соколова Мария Андреевна", title: "Заслуженная артистка России", titled: true },
      { who: "Музыкант", name: "", title: "", titled: false },
      { who: "Вокалист", name: "", title: "", titled: true },
    ],
  },
  price: 685000,
  profile: PROFILE,
  anketaExtra: { "Контактное лицо по договору": "Петров П. П." },
};

// Без единого жёлтого места: всё вписано.
export const FILLED: TpDocx = {
  ...DATA,
  form: { ...DATA.form, consent: "Изучив документацию, участник согласен поставить товар.", smeDeclaration: "Участник относится к субъектам МСП: микропредприятие." },
  goods: [{ name: "Бумага А4", characteristics: "Плотность 80 г/м²", quantity: "500 пачек" }],
  items: [{ clause: "2.1", requirement: "Бумага А4", offer: "Бумага А4, плотность 80 г/м²." }],
  cast: null,
  // Строка формы заказчика сверх реквизитов вписана — жёлтого в анкете не остаётся.
  anketaExtra: { "Контактное лицо по договору": "Петров П. П." },
  profile: { ...PROFILE, ...Object.fromEntries(Object.keys(PROFILE).filter((k) => !(PROFILE as Record<string, string>)[k]).map((k) => [k, "значение"])) } as Profile,
};

export const PARTS = Object.keys(PART_TITLES) as TpPart[];

// Готовый документ, который написал ИИ: заголовок, абзацы, строки и таблица.
export const DOC: PartDoc = {
  title: "Анкета участника закупки",
  basis: "по форме заказчика",
  blocks: [
    { type: "heading", text: "Сведения об участнике", rows: [] },
    { type: "paragraph", text: "Настоящим [участник] подтверждает сведения.\nВторой абзац.", rows: [] },
    { type: "line", text: "Дата: [дата]\nМ.П.", rows: [] },
    { type: "table", text: "", rows: [["№", "Наименование", "Значение"], ["1", "ИНН", "6612345676"], ["2", "Адрес", "[адрес]"]] },
  ],
};
