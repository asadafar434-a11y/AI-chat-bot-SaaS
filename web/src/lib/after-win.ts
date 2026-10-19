// Что подрядчик, поставщик или исполнитель должен сделать после заключения договора: сдать списки и справки в срок, отчитываться по графику.
// Читает код из проекта договора, без ИИ: показываем только то, что в договоре написано, со сроком или с периодичностью, чтобы участник видел это ДО подачи.

type Doc = { name: string; text: string };

export type Duty = { clause: string; text: string; term: string; doc: string };
export type AfterWin = { duties: Duty[]; more: { count: number; range: string } | null };

const SUPPLIER = /(?<![а-яё])(подрядчик|поставщик|исполнитель|продавец)[а-яё]*/i;
const CUSTOMER = /(?<![а-яё])(заказчик|покупатель)[а-яё]*/i;
const GIVE = /(?<![а-яё])(предостав|представ|направ|передав|передат|сообщ|информир)[а-яё]*/i;
// Что отдают: списки, справки, копии, согласия, отчёты, сведения. Акты и счета — обычные расчёты, их не берём.
const OBJECT = /(список|справк|копи[ийя]|согласи|отч[её]т|информаци|сведени|график|приказ|журнал|перечень|реестр)/i;
const SETTLEMENT = /(?<![а-яё])(акт[а-яё]*|сч[её]т[а-яё]*|накладн[а-яё]*|упд|счет-фактур[а-яё]*|счёт-фактур[а-яё]*|приемк[а-яё]*|приёмк[а-яё]*|отч[её]тн[а-яё]*\s+документаци[а-яё]*)(?![а-яё])/i;
const OBLIGED = /(обязан|должен|обязуется|обязуются)/i;

// «в течение 10 календарных дней с момента заключения договора», «в течение трёх рабочих дней».
const TERM = /в\s+течени[ие]\s+[^.;:]{0,60}?(?<![а-яё])(?:дн[а-яё]*|час[а-яё]*|суток)(?:\s+(?:с|со)\s+(?:даты|момента|дня)\s+[а-яё]+(?:\s+[а-яё]+)?)?/i;
// Срок в прошлом («в течение трёх лет до даты подачи заявки») — это условие, а не обязанность.
const PAST = /до\s+(?:даты|момента|подачи)/i;
// Стандартная переписка при изменениях: «в случае изменения банковских реквизитов, смены руководителя … сообщить».
const CHANGES = /(?:изменени[а-яё]*|смен[а-яё]*)\s+(?:банковск|реквизит|адрес|наименовани|руководител|места\s+нахождени)/i;
// «ежеквартально», «каждый вторник», «не реже одного раза в месяц».
const RECURRENCE = /(ежедневно|еженедельно|ежемесячно|ежеквартально|ежегодно|каждый\s+[а-яё]+|каждую\s+[а-яё]+|не\s+реже\s+[^.;,]{0,30})/i;

const CLAUSE = /^\s*((?:\d+\.)+\d*|\d+\))\s*/;
const MAX_DUTIES = 6;
const TEXT_MAX = 230;

// Файл называют по-разному («Приложение № 2 к ДоЗ_ПД»), поэтому договор узнаётся и по первой строке: «Договор поставки № …», «ДОГОВОР ПОДРЯДА №», «Проект контракта».
export const isContract = (doc: Doc) =>
  /договор|контракт/i.test(doc.name) || /^\s*(проект\s+)?(договор|контракт)[а-яё]*(\s+[а-яё]+){0,4}\s*(№|N\s|\n|$)/i.test(doc.text.slice(0, 160));

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const shorten = (s: string) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1).trimEnd()}…` : s);

// Обязанность поставщика отдать документ: поставщик назван раньше заказчика (иначе это обязанность заказчика), есть глагол «предоставить» и предмет.
function isDuty(sentence: string): boolean {
  const supplier = SUPPLIER.exec(sentence);
  const give = GIVE.exec(sentence);
  if (!supplier || !give || !OBJECT.test(sentence)) return false;
  // Поставщик — тот, кто отдаёт: он назван раньше глагола. «Покупатель обязан предоставлять Поставщику Заявку» — обязанность покупателя.
  if (supplier.index > give.index) return false;
  const customer = CUSTOMER.exec(sentence);
  if (customer && customer.index < supplier.index) return false;
  // Акты, счета, накладные — обычные расчёты, а не обязанность отчитываться; уведомления о смене реквизитов — тоже переписка, а не «после победы».
  if (SETTLEMENT.test(sentence) || CHANGES.test(sentence)) return false;
  return true;
}

export function afterWinDuties(documents: Doc[]): AfterWin | null {
  const found: Duty[] = [];
  const untermed: { clause: string }[] = [];
  for (const doc of documents.filter(isContract)) {
    for (const line of doc.text.split(/\n+/)) {
      const clauseMatch = CLAUSE.exec(line);
      const clause = clauseMatch ? clauseMatch[1].replace(/\.$/, "") : "";
      const body = line.replace(CLAUSE, "");
      // Предложения внутри пункта: обязанность — в первом, где она названа.
      for (const sentence of body.split(/(?<=\.)\s+(?=[А-ЯЁ«])/)) {
        if (!isDuty(sentence)) continue;
        const found1 = TERM.exec(sentence)?.[0] ?? "";
        const term = found1 && !PAST.test(found1) ? found1 : (RECURRENCE.exec(sentence)?.[0] ?? "");
        if (term) {
          found.push({ clause, text: shorten(clean(sentence)), term: clean(term), doc: doc.name });
        } else if (OBLIGED.test(sentence) && clause) {
          untermed.push({ clause });
        }
        break;
      }
    }
  }
  if (found.length === 0 && untermed.length === 0) return null;
  const duties = found.slice(0, MAX_DUTIES);
  const rest = found.length - duties.length + untermed.length;
  if (duties.length === 0 && rest < 2) return null;
  const clauses = [...found.slice(MAX_DUTIES).map((d) => d.clause), ...untermed.map((d) => d.clause)].filter(Boolean);
  const range = clauses.length === 0 ? "" : clauses.length === 1 ? `п. ${clauses[0]}` : `п. ${clauses[0]}–${clauses[clauses.length - 1]}`;
  return { duties, more: rest >= 2 ? { count: rest, range } : null };
}
