// Шаблоны заказчика в документации закупки: файлы, которые заказчик дал как образец для заполнения (форма заявки, ценовое предложение, декларация, анкета, приложение с полями).
// Находит код по имени файла и началу текста (doc-classify.ts), без ИИ и без платы: список виден сразу после загрузки, до составления документов.
// Заполненные копии (бланки, которые выделил ИИ, «Спецификация» и «Расчёт цены») стоят в «Составе пакета»; этот список показывает, какие файлы заказчика считаются шаблонами.

import { classifyDoc, DOC_KIND_LABELS, isCustomerForm, type DocKind } from "@/lib/doc-classify";

export type CustomerTemplate = {
  name: string;
  kind: DocKind;
  /** «Форма заказчика», «Форма цены», «Декларация». */
  label: string;
  /** Пустые места под заполнение: «_____», «[   ]», ««__»», строки «поле: ____». */
  blanks: number;
  /** Excel-бланк заказчика вписывается прямо в файл (блок «Excel-бланки заказчика»). */
  excel: boolean;
};

type Doc = { name: string; text: string };

// «_____» от трёх подчёркиваний — пустое место под ответ; многоточие и длинные точки тоже, но в оглавлении они ставятся тоже, поэтому одних точек для вывода «шаблон» мало.
const UNDERSCORES = /_{3,}/g;
const DOT_BLANK = /(?:…{2,}|\.{6,})/g;
const underscoresIn = (text: string): number => text.match(UNDERSCORES)?.length ?? 0;
const dotsIn = (text: string): number => text.match(DOT_BLANK)?.length ?? 0;

// Название файла говорит «образец, форма, бланк, анкета, заявка на участие, ценовое или коммерческое предложение, сведения об участнике, декларация».
const TEMPLATE_NAME = /образц|форм[аыуе](?![а-яё])|бланк|анкет|на\s+участие|ценов[а-яё]*\s+предложени|коммерческ|сведени[яй]\s+об\s+участник|декларац|согласи[ея]|специфик|расч[её]т\s+цен/i;
// А это документы самого заказчика, а не образцы для заполнения: описание объекта, обоснование цены, технические требования, порядок, перечни, проект договора.
const NOT_TEMPLATE_NAME = /обоснован|описани[ея]\s+объект|технич[а-яё]*\s+(?:задани|требовани)|порядок|требовани[яе]\s+к|перечень|проект\s+(?:договор|контракт)|информационн[а-яё]*\s+письм|горяч[а-яё]*\s+лини|(?:^|[\s_])ТТ(?:[\s_.]|$)/i;
const MIN_UNDERSCORES = 3;

/** Файлы документации, которые считаются шаблонами заказчика: название образца или формы, либо не меньше трёх пустых мест «____» в тексте; порядок — как загружены. */
export function customerTemplates(documents: Doc[]): CustomerTemplate[] {
  const out: CustomerTemplate[] = [];
  const seen = new Set<string>();
  for (const d of documents) {
    const kind = classifyDoc(d.name, d.text);
    if (!isCustomerForm(kind)) continue;
    const base = d.name.replace(/\.[^.]+$/, "");
    const underscores = underscoresIn(d.text);
    if (NOT_TEMPLATE_NAME.test(base) || !(TEMPLATE_NAME.test(base) || underscores >= MIN_UNDERSCORES)) continue;
    const key = d.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: d.name, kind, label: DOC_KIND_LABELS[kind], blanks: underscores + dotsIn(d.text), excel: /\.xls[xm]$/i.test(d.name) });
  }
  return out;
}
